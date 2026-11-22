import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSessionController } from "../src/agent/session-controller.js";
import { createSessionStore, newSession } from "../src/agent/session-store.js";

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-session-lock-"));
  const directory = path.join(root, "sessions");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory, store: createSessionStore(directory) };
}

function controllerFor(workspace, sessionStore) {
  let messages = [];
  let persisted = false;
  return createSessionController({
    workspace,
    sessionStore,
    getMessages: () => messages,
    setMessages: (value) => (messages = value),
    getPendingShellContext: () => [],
    setPendingShellContext: () => {},
    addMessage: (message) => messages.push(message),
    notify: () => {},
    updateStatus: () => {},
    isGenerating: () => false,
    isRouting: () => false,
    getActiveDownload: () => null,
    isShuttingDown: () => false,
    getSessionPersisted: () => persisted,
    setSessionPersisted: (value) => (persisted = value),
  });
}

const locked = { code: "SESSION_LOCKED" };

test("a live process excludes writers for its session ID, and killing it frees that ID", async (t) => {
  const { root, directory, store } = await setup(t);
  const record = newSession(root);
  await store.save(record);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createSessionStore } from ${JSON.stringify(new URL("../src/agent/session-store.js", import.meta.url).href)};
       const lease = await createSessionStore(process.argv[1]).acquire(process.argv[2]);
       process.send("locked");
       setInterval(() => {}, 1000);`,
      directory,
      record.id,
    ],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill("SIGKILL");
    await exited;
  });
  assert.equal(
    await Promise.race([once(child, "message").then(([message]) => message), exited]),
    "locked",
  );
  assert.equal((await store.load(record.id)).id, record.id, "read-only access remains available");
  await assert.rejects(store.acquire(record.id), locked);
  await assert.rejects(store.save({ ...record, title: "Blocked" }), locked);
  await assert.rejects(store.remove(record.id), locked);
  await store.save(newSession(root));
  child.kill("SIGKILL");
  await exited;
  const lease = await store.acquire(record.id);
  try {
    await store.save({ ...record, title: "Recovered" }, lease);
  } finally {
    lease.release();
  }
  assert.equal((await store.load(record.id)).title, "Recovered");
});

test("restore locks before reading and keeps ownership through rename, switch and final save", async (t) => {
  const { root, directory, store } = await setup(t);
  const record = newSession(root);
  const other = newSession(root);
  await store.save(record);
  await store.save(other);
  const competingStore = createSessionStore(directory);
  const owner = controllerFor(root, {
    ...store,
    async load(id) {
      await assert.rejects(competingStore.acquire(id), locked);
      return store.load(id);
    },
  });
  const contender = controllerFor(root, competingStore);
  t.after(async () => {
    await owner.shutdownSession();
    await contender.shutdownSession();
  });
  await owner.restoreSession(record.id);
  assert.equal(owner.getActiveSession().id, record.id);
  await contender.restoreSession(other.id);
  await contender.openSessionPicker();
  await contender.restoreSession(record.id);
  assert.equal(contender.getActiveSession().id, other.id);
  assert.match(contender.getState().sessionModal.error, /in use/);
  assert.equal(await contender.renameSession(record.id, "Blocked"), false);
  assert.equal(await contender.deleteSession(record.id), false);
  assert.equal((await store.load(record.id)).title, "New session");
  owner.updateDraft({ value: "Retain this", cursor: 6 });
  assert.equal(await owner.renameSession(record.id, "Owner renamed"), true);
  assert.deepEqual((await store.load(record.id)).draft, { value: "Retain this", cursor: 6 });
  owner.updateDraft({ value: "Saved on switch", cursor: 5 });
  assert.equal(await owner.startNewSession(), true);
  await contender.restoreSession(record.id);
  assert.equal(contender.getActiveSession().id, record.id);
  assert.equal(contender.getState().currentSession.title, "Owner renamed");
  assert.equal(contender.getState().sessionDraft.value, "Saved on switch");
  contender.updateDraft({ value: "Saved on exit", cursor: 5 });
  await contender.shutdownSession();
  assert.equal((await store.load(record.id)).draft.value, "Saved on exit");
  assert.equal(await owner.deleteSession(record.id), true);
  await assert.rejects(store.load(record.id), { code: "ENOENT" });
});

test("failed restore releases the target, but failed switch keeps the dirty active session locked", async (t) => {
  const { root, directory, store } = await setup(t);
  const record = newSession(root);
  const foreign = newSession(path.join(root, "foreign"));
  await store.save(record);
  await store.save(foreign);
  let saveError;
  const owner = controllerFor(root, {
    ...store,
    save(snapshot, lease) {
      if (saveError) return Promise.reject(saveError);
      return store.save(snapshot, lease);
    },
  });
  const competingStore = createSessionStore(directory);
  await owner.restoreSession(record.id);
  await owner.restoreSession(foreign.id);
  assert.match(owner.getState().sessionError, /another workspace/);
  (await competingStore.acquire(foreign.id)).release();
  owner.updateDraft({ value: "Dirty", cursor: 2 });
  saveError = new Error("Disk failure");
  assert.equal(await owner.startNewSession(), false);
  assert.equal(owner.getActiveSession().id, record.id);
  assert.equal(owner.getState().sessionDraft.value, "Dirty");
  await assert.rejects(competingStore.acquire(record.id), locked);
  await assert.rejects(owner.shutdownSession(), /Disk failure/);
  (await competingStore.acquire(record.id)).release();
});
test("active deletion drains pending saves and does not recreate the deleted session", async (t) => {
  const { root, directory, store } = await setup(t);
  const record = newSession(root);
  await store.save(record);
  const owner = controllerFor(root, store);
  await owner.restoreSession(record.id);
  owner.updateDraft({ value: "Pending write", cursor: 5 });
  const pending = owner.saveCurrentSession();
  const deleting = owner.deleteSession(record.id);
  const late = owner.saveCurrentSession({ force: true });
  await pending;
  assert.equal(await deleting, true);
  await late;
  assert.notEqual(owner.getActiveSession().id, record.id);
  await assert.rejects(store.load(record.id), { code: "ENOENT" });
  (await createSessionStore(directory).acquire(record.id)).release();
  await owner.shutdownSession();
});
