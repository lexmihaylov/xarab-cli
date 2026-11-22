import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createModelManager } from "../src/agent/local-model-manager.js";
import { createSingleConfigStore } from "../src/single/config-store.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-models-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const modelsDir = path.join(root, "models");
  await mkdir(modelsDir);
  const id = path.join(modelsDir, "model.gguf");
  await writeFile(id, "test");
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ models: { [id]: { name: "Model" } } }));
  const configStore = createSingleConfigStore(configPath);
  await configStore.load();
  return { root, modelsDir, id, configPath, configStore };
}

function chooser({ id, ...dependencies }) {
  let modal = { mode: "chooser", models: [{ provider: "local", id }] };
  const setModal = (next) => {
    modal = next;
  };
  const manager = createModelManager({
    appMode: "single",
    isLocalModelInUse: () => false,
    getModelModal: () => modal,
    setModelModal: setModal,
    notify: () => {},
    ...dependencies,
  });
  return { manager, getModal: () => modal, setModal };
}

test("local model discovery returns provider, path ID, and configured display name", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.modelsDir, "other.txt"), "test");
  assert.deepEqual(await createModelManager(f).listModels(), [
    { provider: "local", id: f.id, name: "Model" },
  ]);
});

test("deletion requires explicit single mode and a synchronous idle check", async (t) => {
  const f = await fixture(t);
  await f.configStore.setSingleModel({ provider: "local", model: f.id });
  for (const [dependencies, reason] of [
    [{ appMode: undefined }, /only available in xarab-one/],
    [{ appMode: "tiered" }, /only available in xarab-one/],
    [{ isLocalModelInUse: undefined }, /not configured/],
    [{ isLocalModelInUse: () => undefined }, /work to finish/],
    [{ isLocalModelInUse: async () => false }, /work to finish/],
    [{ isLocalModelInUse: (id) => id === f.id }, /work to finish/],
    [{ getActiveDownload: () => ({}) }, /download to finish/],
  ]) {
    const { manager, getModal } = chooser({ ...f, ...dependencies });
    const result = await manager.deleteModel(f.id);
    assert.equal(result.deleted, false);
    assert.match(result.error, reason);
    assert.equal(getModal().error, result.error);
    assert.equal(manager.isModelDeletionPending(), false);
    assert.equal(await readFile(f.id, "utf8"), "test");
    assert.deepEqual(f.configStore.getSingleModel(), { provider: "local", model: f.id });
    assert.deepEqual(f.configStore.getModel(f.id), { name: "Model" });
  }
});

test("deletion rejects outside and nested paths, non-GGUFs, directories and symlinks", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside.gguf");
  const nested = path.join(f.modelsDir, "nested");
  const directory = path.join(f.modelsDir, "directory.gguf");
  const link = path.join(f.modelsDir, "link.gguf");
  const linkedRoot = path.join(f.root, "linked-models");
  const wrongType = path.join(f.modelsDir, "model.txt");
  const nestedFile = path.join(nested, "inside.gguf");
  await Promise.all([
    mkdir(nested),
    mkdir(directory),
    writeFile(outside, "outside"),
    writeFile(wrongType, "text"),
  ]);
  await Promise.all([
    writeFile(nestedFile, "nested"),
    symlink(outside, link),
    symlink(f.modelsDir, linkedRoot, "dir"),
  ]);
  const { manager } = chooser(f);
  const traversal = [nested, "..", path.basename(f.id)].join(path.sep);
  for (const target of [outside, nestedFile, wrongType, directory, link, traversal, undefined]) {
    assert.equal((await manager.deleteModel(target)).deleted, false);
  }
  const linkedId = path.join(linkedRoot, path.basename(f.id));
  const { manager: linkedManager } = chooser({ ...f, modelsDir: linkedRoot, id: linkedId });
  assert.equal((await linkedManager.deleteModel(linkedId)).deleted, false);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  assert.equal((await lstat(directory)).isDirectory(), true);
  assert.equal(await readFile(outside, "utf8"), "outside");
  assert.equal(await readFile(nestedFile, "utf8"), "nested");
  assert.equal(await readFile(wrongType, "utf8"), "text");
  assert.equal(await readFile(f.id, "utf8"), "test");
});

test("deleting a selected idle model clears its assignment and metadata even if the chooser closes", async (t) => {
  const f = await fixture(t);
  await f.configStore.setSingleModel({ provider: "local", model: f.id });
  const release = Promise.withResolvers();
  const { manager, getModal, setModal } = chooser({
    ...f,
    configStore: {
      ...f.configStore,
      async removeDeletedLocalModel(id) {
        await release.promise;
        return f.configStore.removeDeletedLocalModel(id);
      },
    },
  });
  const deletion = manager.deleteModel(f.id);
  assert.equal(manager.isModelDeletionPending(), true);
  assert.match((await manager.deleteModel(f.id)).error, /already in progress/);
  setModal({ mode: "download" });
  assert.equal(manager.downloadModel("uri", "model.gguf"), undefined);
  setModal(null);
  release.resolve();
  assert.deepEqual(await deletion, { deleted: true, clearedSingleModel: true, error: null });
  assert.equal(manager.isModelDeletionPending(), false);
  assert.equal(getModal(), null);
  await assert.rejects(lstat(f.id), { code: "ENOENT" });
  const persisted = JSON.parse(await readFile(f.configPath, "utf8"));
  assert.equal(persisted.singleModel, null);
  assert.deepEqual(persisted.models, {});
});

test("deletion retains provider models discovered during cleanup", async (t) => {
  const f = await fixture(t);
  const remaining = path.join(f.modelsDir, "remaining.gguf");
  await writeFile(remaining, "test");
  const remote = { provider: "openai", id: "remote", name: "Remote" };
  const { manager, getModal, setModal } = chooser({
    ...f,
    configStore: {
      ...f.configStore,
      async removeDeletedLocalModel(id) {
        setModal({
          ...getModal(),
          models: [...getModal().models, remote],
          loadingProviderModels: false,
        });
        return f.configStore.removeDeletedLocalModel(id);
      },
    },
  });
  assert.equal((await manager.deleteModel(f.id)).deleted, true);
  assert.deepEqual(getModal().models, [
    { provider: "local", id: remaining, name: "remaining.gguf" },
    remote,
  ]);
  assert.deepEqual(getModal().modelSettings, { [remaining]: {} });
  assert.equal(getModal().loadingProviderModels, false);
});

test("deletion does not overwrite a newer assignment or a newly opened chooser", async (t) => {
  const f = await fixture(t);
  await f.configStore.setSingleModel({ provider: "local", model: f.id });
  const concurrentStore = createSingleConfigStore(f.configPath);
  const replacement = { provider: "openai", model: "other" };
  const reopenedModal = { mode: "chooser", models: [], loadingProviderModels: true };
  const { manager, getModal, setModal } = chooser({
    ...f,
    configStore: {
      ...f.configStore,
      async removeDeletedLocalModel(id) {
        setModal(reopenedModal);
        await concurrentStore.setSingleModel(replacement);
        return f.configStore.removeDeletedLocalModel(id);
      },
    },
  });
  assert.deepEqual(await manager.deleteModel(f.id), {
    deleted: true,
    clearedSingleModel: false,
    error: null,
  });
  assert.deepEqual(f.configStore.getSingleModel(), replacement);
  assert.deepEqual(f.configStore.getModels(), {});
  assert.equal(getModal(), reopenedModal);
});

test("cleanup errors are reported separately from unlink errors and the removed model leaves the chooser", async (t) => {
  const f = await fixture(t);
  const { manager, getModal } = chooser({
    ...f,
    configStore: {
      ...f.configStore,
      async removeDeletedLocalModel() {
        throw new Error("config write failed");
      },
    },
  });
  const result = await manager.deleteModel(f.id);
  assert.equal(result.deleted, true);
  assert.match(result.error, /Model deleted.*config write failed/);
  assert.equal(getModal().error, result.error);
  assert.deepEqual(getModal().models, []);
  assert.equal(manager.isModelDeletionPending(), false);
  await assert.rejects(lstat(f.id), { code: "ENOENT" });
});
