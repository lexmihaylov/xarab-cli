import test from "node:test";
import assert from "node:assert/strict";
import { createActiveWork } from "../src/agent/controller/active-work.js";
import { runWorker } from "../src/agent/controller/worker-turn.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const events = [];
  const session = { id: "session" };
  const deps = {
    activeWork: createActiveWork(),
    messages: [],
    pendingShellContext: [],
    suggestionVersion: 0,
    appPolicy: { tracksUsage: () => false },
    configStore: { get: () => ({}) },
    routing: { mayAdjust: () => false },
    sessionController: {
      getActiveSession: () => session,
      getState: () => ({ currentSession: session }),
    },
    getActiveSession: () => session,
    addMessage: (message) => deps.messages.push(message),
    appendAssistantText: (text) => {
      deps.currentAgentMessage.message += text;
    },
    updateStatus: (status) => {
      deps.status = status;
    },
    sessionChanged() {},
    notify() {},
    setSessionError() {},
    saveCurrentSession: async () => {
      events.push("save");
    },
    autoCompactor: {
      compact: async () => {
        events.push("compact");
      },
    },
    tasks: {
      suggest: () => {
        events.push("suggest");
      },
    },
    turnCoordinator: {
      markReplyComplete() {},
      markInterrupted: () => events.push("interrupted"),
    },
  };
  return { deps, events };
}

test("cleanup and save precede compaction, work completion and suggestion", async () => {
  const { deps, events } = setup();
  const save = deferred();
  const compact = deferred();
  deps.saveCurrentSession = async () => {
    events.push("save");
    await save.promise;
  };
  deps.autoCompactor.compact = async () => {
    events.push("compact");
    await compact.promise;
  };
  deps.worker = {
    run: async ({ onText, onEvent }) => {
      onText("answer");
      onEvent({ type: "local_context_usage", contextSize: 100, occupiedTokens: 90 });
    },
  };
  const turn = runWorker(deps, "question");
  const work = deps.activeWork.whenIdle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["save"]);
  assert.equal(deps.activeWork.isGenerating(), false);
  assert.equal(deps.currentAgentMessage, undefined);
  assert.equal(deps.activeWork.getCurrent().signal.aborted, false);
  save.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["save", "compact"]);
  let finished = false;
  work.then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  compact.resolve();
  await turn;
  assert.equal(finished, true);
  assert.equal(deps.activeWork.whenIdle(), undefined);
  assert.deepEqual(events, ["save", "compact", "suggest"]);
});

test("handoff starts after save and shares the worker lifetime and signal", async () => {
  const { deps, events } = setup();
  const save = deferred();
  let firstWork;
  let firstSignal;
  let count = 0;
  deps.saveCurrentSession = async () => {
    events.push("save");
    if (count === 1) await save.promise;
  };
  deps.worker = {
    getTierInfo: () => ({ model: "next" }),
    async run({ onEvent, signal }) {
      count++;
      events.push(`run${count}`);
      if (count === 1) {
        firstSignal = signal;
        onEvent({ type: "local_context_usage", contextSize: 100, occupiedTokens: 90 });
        return {
          handoff: { selectedTier: 2, previousTier: 1, findings: "found", reason: "reason" },
        };
      }
      assert.equal(deps.activeWork.whenIdle(), firstWork);
      assert.equal(signal, firstSignal);
    },
  };
  const turn = runWorker(deps, "question", { tier: 1, userMessage: { classification: {} } });
  firstWork = deps.activeWork.whenIdle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["run1", "save"]);
  save.resolve();
  await Promise.all([turn, firstWork]);
  assert.deepEqual(events, ["run1", "save", "run2", "save"]);
});

for (const stage of ["cleanup", "compaction"]) {
  test(`${stage} rejection remains observable and settles registered work`, async () => {
    const { deps } = setup();
    const running = deferred();
    deps.worker = {
      async run({ onEvent }) {
        await running.promise;
        onEvent({ type: "local_context_usage", contextSize: 100, occupiedTokens: 90 });
      },
    };
    if (stage === "cleanup") {
      deps.updateStatus = (status) => {
        if (status === "Ready") {
          throw new Error("cleanup failed");
        }
      };
    } else {
      deps.autoCompactor.compact = async () => {
        throw new Error("compaction failed");
      };
    }
    const turn = runWorker(deps, "question");
    const settled = deps.activeWork.whenIdle();
    running.resolve();
    await assert.rejects(turn, new RegExp(`${stage} failed`));
    await settled;
    assert.equal(deps.currentAgentMessage, undefined);
    assert.equal(deps.activeWork.getCurrent(), undefined);
  });
}
