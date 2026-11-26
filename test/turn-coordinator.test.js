import test from "node:test";
import assert from "node:assert/strict";
import { createTurnCoordinator } from "../src/agent/controller/turn-coordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(overrides = {}) {
  const events = [];
  const coordinator = createTurnCoordinator({
    isShuttingDown: () => false,
    isModelDeletionPending: () => false,
    isSessionOperation: () => false,
    isCommandRunning: () => false,
    isGenerating: () => false,
    isRouting: () => false,
    getActiveSession: () => ({ id: "session" }),
    onQuit() {},
    addMessage() {},
    updateDraft() {},
    sessionChanged() {},
    handleCommand: async (text) => {
      events.push(text);
    },
    setLastTurnInterrupted() {},
    saveCurrentSession: async () => {
      events.push("save");
    },
    setSessionError() {},
    notify() {},
    ...overrides,
  });
  return { coordinator, events };
}

test("queued turns drain FIFO only after completion save", async () => {
  const work = deferred();
  const save = deferred();
  const events = [];
  let coordinator;
  ({ coordinator } = setup({
    async handleCommand(text) {
      events.push(text);
      if (text === "first") await work.promise;
    },
    async saveCurrentSession() {
      events.push(`save:${coordinator.isTurnRunning()}`);
      if (events.length === 2) await save.promise;
    },
  }));
  const first = coordinator.submit("first");
  await coordinator.submit("second");
  assert.deepEqual(
    coordinator.getQueuedMessages("session").map(({ id }) => id),
    [1],
  );
  work.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first", "save:true"]);
  assert.equal(coordinator.isTurnRunning(), true);
  await coordinator.submit("third");
  await coordinator.submit("/help");
  assert.deepEqual(events, ["first", "save:true"]);
  assert.deepEqual(
    coordinator.getQueuedMessages("session").map(({ text }) => text),
    ["second", "third"],
  );
  save.resolve();
  await first;
  assert.deepEqual(events, ["first", "save:true", "second", "save:true", "third", "save:true"]);
});

test("interruption leaves queued messages pending", async () => {
  const work = deferred();
  const events = [];
  const { coordinator } = setup({
    async handleCommand(text) {
      events.push(text);
      await work.promise;
    },
    async saveCurrentSession() {
      events.push("save");
    },
  });
  const first = coordinator.submit("first");
  await coordinator.submit("second");
  coordinator.markInterrupted();
  work.resolve();
  await first;
  assert.deepEqual(events, ["first"]);
  assert.deepEqual(
    coordinator.getQueuedMessages("session").map(({ text }) => text),
    ["second"],
  );
});

for (const reason of ["stop", "shutdown"]) {
  test(`${reason} during completion save does not drain the queue`, async () => {
    const saving = deferred();
    const save = deferred();
    const events = [];
    let shuttingDown = false;
    const interruptions = [];
    const { coordinator } = setup({
      isShuttingDown: () => shuttingDown,
      setLastTurnInterrupted: (value) => interruptions.push(value),
      async handleCommand(text) {
        events.push(text);
      },
      async saveCurrentSession() {
        saving.resolve();
        await save.promise;
      },
    });
    const first = coordinator.submit("first");
    await saving.promise;
    await coordinator.submit("second");
    if (reason === "stop") {
      coordinator.pauseQueue();
      coordinator.markInterrupted();
    } else {
      shuttingDown = true;
    }
    let idle = false;
    const settled = coordinator.whenIdle().then(() => (idle = true));
    await Promise.resolve();
    assert.equal(idle, false);
    save.resolve();
    await Promise.all([first, settled]);
    assert.deepEqual(events, ["first"]);
    assert.deepEqual(interruptions, [false]);
    assert.deepEqual(
      coordinator.getQueuedMessages("session").map(({ text }) => text),
      ["second"],
    );
  });
}
