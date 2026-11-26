import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantController } from "../src/agent/controller/index.js";
import { createSessionStore } from "../src/agent/session-store.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xarab-lifecycle-"));
  const sessionsDir = path.join(root, "sessions");
  const controller = createAssistantController({
    root,
    mode: "tiered",
    workspace: root,
    sessionsDir,
    instructionFiles: [],
    configPath: path.join(root, "config.json"),
    automaticTitles: false,
    automaticSuggestions: false,
    classifierFactory: () => ({
      async load() {},
      async dispose() {},
      async classify() {
        return { valid: true, tier: 1, rationale: "Routine" };
      },
    }),
    ...options,
  });
  t.after(async () => {
    await controller.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });
  await controller.initialize();
  await controller.setRouterClassifier({ provider: "openai", model: "classifier" });
  await controller.setRouterTierWorker(1, { provider: "openai", model: "small" });
  await controller.setRouterTierWorker(3, { provider: "openai", model: "large" });
  const sessionFile = path.join(sessionsDir, `${controller.getState().currentSession.id}.json`);
  return { controller, sessionFile };
}

function deferSessionSave(t, sessionFile, shouldBlock = () => true) {
  const entered = deferred();
  const release = deferred();
  const written = deferred();
  t.signal.addEventListener("abort", release.resolve, { once: true });
  const rename = fs.rename;
  const mock = t.mock.method(fs, "rename", async (from, to) => {
    if (to !== sessionFile || !shouldBlock()) {
      return rename(from, to);
    }
    entered.resolve();
    await release.promise;
    await rename(from, to);
    written.resolve();
  });
  syncBuiltinESMExports();
  return {
    entered: entered.promise,
    written: written.promise,
    release: release.resolve,
    restore() {
      release.resolve();
      mock.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

for (const reason of ["stop", "shutdown"]) {
  test(
    `${reason} prevents a handoff while the outgoing worker's save is pending`,
    { timeout: 5000 },
    async (t) => {
      let signal;
      let runs = 0;
      let disposed = false;
      const { controller, sessionFile } = await setup(t, {
        openAIAdapterFactory: () => ({
          async run(request) {
            runs++;
            signal = request.signal;
            return {
              handoff: {
                selectedTier: 3,
                previousTier: 1,
                findings: "Findings",
                requestedCapability: "Reasoning",
                reason: "Complexity",
              },
            };
          },
          async dispose() {
            disposed = true;
          },
        }),
      });
      const save = deferSessionSave(t, sessionFile);
      try {
        const turn = controller.submit("Start a turn");
        await save.entered;
        await controller.submit("Follow-up");
        let shutdown;
        if (reason === "stop") {
          controller.stopGeneration();
        } else {
          shutdown = controller.shutdown();
        }
        assert.equal(signal.aborted, true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(disposed, false);
        assert.equal(controller.getState().generating, true);
        save.release();
        await Promise.all([turn, shutdown]);
        assert.equal(runs, 1);
        assert.equal(disposed, reason === "shutdown");
        assert.equal(controller.getState().generating, false);
        if (reason === "stop") {
          await controller.saveSession();
        }
        const record = JSON.parse(await fs.readFile(sessionFile, "utf8"));
        assert.equal(record.interrupted, true);
        assert.deepEqual(
          controller.getState().queuedMessages.map(({ text }) => text),
          ["Follow-up"],
        );
      } finally {
        save.restore();
      }
    },
  );
}

test(
  "a completion save is exclusive but persists a non-interrupted turn",
  { timeout: 5000 },
  async (t) => {
    let runs = 0;
    const { controller, sessionFile } = await setup(t, {
      openAIAdapterFactory: () => ({
        async run(request) {
          runs++;
          request.onText("Response");
        },
      }),
    });
    let saves = 0;
    const save = deferSessionSave(t, sessionFile, () => ++saves === 2);
    try {
      const turn = controller.submit("Start a turn");
      await save.entered;
      const originalSession = controller.getState().currentSession.id;
      assert.equal(controller.getState().generating, true);
      await controller.startNewSession();
      assert.equal(controller.getState().currentSession.id, originalSession);
      await controller.submit("Follow-up");
      assert.equal(runs, 1);
      save.release();
      await turn;
      assert.equal(runs, 2);
      const record = JSON.parse(await fs.readFile(sessionFile, "utf8"));
      assert.equal(record.interrupted, false);
    } finally {
      save.restore();
    }
  },
);

test(
  "stop during the completion save pauses the queue without interrupting the reply",
  { timeout: 5000 },
  async (t) => {
    let runs = 0;
    const { controller, sessionFile } = await setup(t, {
      openAIAdapterFactory: () => ({
        async run(request) {
          runs++;
          request.onText("Response");
        },
      }),
    });
    let saves = 0;
    const save = deferSessionSave(t, sessionFile, () => ++saves === 2);
    try {
      const turn = controller.submit("Start a turn");
      await save.entered;
      await controller.submit("Follow-up");
      controller.stopGeneration();
      save.release();
      await turn;
      assert.equal(runs, 1);
      assert.deepEqual(
        controller.getState().queuedMessages.map(({ text }) => text),
        ["Follow-up"],
      );
      // Flush any later revision: the blocked write's snapshot predates stop.
      await controller.shutdown();
      const record = JSON.parse(await fs.readFile(sessionFile, "utf8"));
      assert.equal(record.interrupted, false);
      assert.ok(record.messages.some(({ message }) => message === "Response"));
    } finally {
      save.restore();
    }
  },
);

for (const reason of ["stop", "shutdown"]) {
  test(
    `${reason} during auto-compaction leaves the completed reply and queued prompt intact`,
    { timeout: 5000 },
    async (t) => {
      const entered = deferred();
      const release = deferred();
      t.signal.addEventListener("abort", release.resolve, { once: true });
      let compactSignal;
      let runs = 0;
      const { controller, sessionFile } = await setup(t, {
        openAIAdapterFactory: () => ({
          async run(request) {
            if (Object.keys(request.tools).length) {
              runs++;
              request.onEvent({
                type: "local_context_usage",
                contextSize: 100,
                occupiedTokens: 85,
              });
              request.onText("Response");
            } else {
              compactSignal = request.signal;
              entered.resolve();
              await release.promise;
              request.onText("Summary");
            }
          },
        }),
      });
      const turn = controller.submit("Start a turn");
      let checkpoint;
      try {
        await entered.promise;
        await controller.submit("Follow-up");
        let shutdown;
        if (reason === "stop") {
          controller.stopGeneration();
        } else {
          checkpoint = deferSessionSave(t, sessionFile);
          shutdown = controller.shutdown();
        }
        assert.equal(compactSignal.aborted, true);
        if (checkpoint) {
          await checkpoint.entered;
          checkpoint.release();
          await checkpoint.written;
          const record = JSON.parse(await fs.readFile(sessionFile, "utf8"));
          assert.equal(record.interrupted, false);
        }
        release.resolve();
        await Promise.all([turn, shutdown]);
        assert.equal(runs, 1);
        assert.deepEqual(
          controller.getState().queuedMessages.map(({ text }) => text),
          ["Follow-up"],
        );
        await controller.shutdown();
        const record = JSON.parse(await fs.readFile(sessionFile, "utf8"));
        assert.equal(record.interrupted, false);
        assert.ok(record.messages.some(({ message }) => message === "Response"));
        assert.ok(!record.messages.some(({ autoCompactSummary }) => autoCompactSummary));
      } finally {
        checkpoint?.restore();
        release.resolve();
      }
    },
  );
}

test(
  "shutdown waits for auto-compaction cleanup and reports its rejection",
  { timeout: 5000 },
  async (t) => {
    const entered = deferred();
    const release = deferred();
    let workerSignal;
    let compactSignal;
    let disposed = false;
    let failCleanup = false;
    const { controller } = await setup(t, {
      onStateChange({ status }) {
        if (failCleanup && status === "Ready") {
          failCleanup = false;
          throw new Error("Unexpected compaction cleanup rejection");
        }
      },
      openAIAdapterFactory: () => ({
        async run(request) {
          if (Object.keys(request.tools).length) {
            workerSignal = request.signal;
            request.onEvent({ type: "local_context_usage", contextSize: 100, occupiedTokens: 85 });
            request.onText("Response");
          } else {
            compactSignal = request.signal;
            entered.resolve();
            await release.promise;
          }
        },
        async dispose() {
          disposed = true;
        },
      }),
    });
    const turn = controller.submit("Start a turn");
    try {
      await entered.promise;
      assert.equal(compactSignal, workerSignal);
      failCleanup = true;
      const shutdown = controller.shutdown();
      assert.equal(compactSignal.aborted, true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(disposed, false);
      release.resolve();
      await Promise.all([turn, shutdown]);
      assert.equal(disposed, true);
      assert.equal(controller.getState().generating, false);
      assert.ok(
        controller
          .getState()
          .messages.some(
            ({ message, severity }) =>
              severity === "error" && message.includes("Unexpected compaction cleanup rejection"),
          ),
      );
    } finally {
      release.resolve();
    }
  },
);

test(
  "shutdown checkpoints a partial reply before worker cleanup and disposes after the final save",
  { timeout: 5000 },
  async (t) => {
    const running = deferred();
    const finish = deferred();
    t.signal.addEventListener("abort", finish.resolve, { once: true });
    let signal;
    let disposed = false;
    let savedAtDisposal;
    const { controller, sessionFile } = await setup(t, {
      openAIAdapterFactory: () => ({
        async run(request) {
          signal = request.signal;
          request.onTextDelta("Partial reply");
          running.resolve();
          await finish.promise;
          request.onTextDelta(" and final cleanup");
        },
        async dispose() {
          disposed = true;
          const store = createSessionStore(path.dirname(sessionFile));
          const id = path.basename(sessionFile, ".json");
          const lease = await store.acquire(id);
          try {
            savedAtDisposal = await store.load(id);
          } finally {
            lease.release();
          }
        },
      }),
    });
    const checkpoint = deferSessionSave(t, sessionFile);
    let finalSave;
    try {
      const turn = controller.submit("Start a turn");
      await running.promise;
      const shutdown = controller.shutdown();
      assert.equal(signal.aborted, true);
      await checkpoint.entered;
      checkpoint.release();
      await checkpoint.written;
      const partial = JSON.parse(await fs.readFile(sessionFile, "utf8"));
      assert.equal(partial.interrupted, true);
      assert.ok(partial.messages.some(({ message }) => message === "Partial reply"));
      assert.equal(controller.getState().generating, true);
      assert.equal(disposed, false);

      checkpoint.restore();
      finalSave = deferSessionSave(t, sessionFile);
      finish.resolve();
      await finalSave.entered;
      assert.equal(disposed, false);
      finalSave.release();
      await Promise.all([turn, shutdown]);
      assert.equal(disposed, true);
      assert.equal(savedAtDisposal.interrupted, true);
      assert.equal(
        savedAtDisposal.messages.find(({ type }) => type === "agent")?.message,
        "Partial reply and final cleanup",
      );
    } finally {
      finalSave?.restore();
      if (!finalSave) {
        checkpoint.restore();
      }
      finish.resolve();
    }
  },
);

test(
  "stop holds manual compaction cancelled across deferred classification",
  { timeout: 5000 },
  async (t) => {
    const entered = deferred();
    const release = deferred();
    let classifierSignal;
    let runs = 0;
    const { controller } = await setup(t, {
      classifierFactory: () => ({
        async load() {},
        async dispose() {},
        async classify({ prompt, signal }) {
          if (prompt.startsWith("Compact the current conversation")) {
            classifierSignal = signal;
            entered.resolve();
            await release.promise;
          }
          return { valid: true, tier: 1, rationale: "Routine" };
        },
      }),
      openAIAdapterFactory: () => ({
        async run(request) {
          runs++;
          request.onText("Response");
        },
      }),
    });
    await controller.submit("Populate the conversation");
    const compaction = controller.submit("/compact");
    try {
      await entered.promise;
      await controller.submit("Follow-up");
      controller.stopGeneration();
      assert.equal(classifierSignal.aborted, true);
      release.resolve();
      await compaction;
      assert.equal(runs, 1);
      assert.equal(controller.getState().generating, false);
      assert.deepEqual(
        controller.getState().queuedMessages.map(({ text }) => text),
        ["Follow-up"],
      );
    } finally {
      release.resolve();
    }
  },
);
