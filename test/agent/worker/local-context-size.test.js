import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSingleConfigStore } from "../../../src/single/utils/config-store.js";
import { createLocalLlamaWorkerAdapter } from "../../../src/agent/worker/local-llama-worker-adapter.js";

test("per-model context settings persist, validate, and reset without losing metadata", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xarab-context-"));
  try {
    const file = path.join(dir, "config.json");
    const a = path.join(dir, "a.gguf"),
      b = path.join(dir, "b.gguf");
    await writeFile(
      file,
      JSON.stringify({
        models: { [a]: { name: "A", extra: true, contextSize: -1 }, [b]: { contextSize: 4096 } },
        other: true,
      }),
    );
    const store = createSingleConfigStore(file);
    await store.load();
    assert.deepEqual(store.getModel(a), { name: "A" });
    for (const bad of [0, -1, 1.5, NaN, "8192", Number.MAX_SAFE_INTEGER + 1])
      await assert.rejects(store.setModelContextSize(a, bad), /positive safe integer/);
    await store.setModelContextSize(a, 8192);
    const reloaded = createSingleConfigStore(file);
    await reloaded.load();
    assert.deepEqual(reloaded.getModel(a), { name: "A", contextSize: 8192 });
    assert.equal(reloaded.getModel(b).contextSize, 4096);
    await reloaded.setModelContextSize(a, undefined);
    const raw = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(raw.models[a], { name: "A", extra: true });
    assert.equal(raw.other, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local contexts follow model settings and safely replace cached lanes", async () => {
  let size;
  const events = [];
  const adapter = createLocalLlamaWorkerAdapter({
    getContextSize: () => size,
    modelRuntime: {
      async getLlama() {
        return {
          async loadModel() {
            return {
              async createContext({ contextSize }) {
                events.push(`create:${contextSize}`);
                return {
                  getSequence: () => ({ clearHistory() {}, dispose() {} }),
                  dispose() {
                    events.push(`dispose:${contextSize}`);
                  },
                };
              },
              dispose() {
                events.push("model-dispose");
              },
            };
          },
        };
      },
      createSession({ contextShift }) {
        return {
          async prompt(input, { functions }) {
            events.push(`shift:${typeof contextShift.strategy}`);
            if (input === "parent") await functions.check.handler({});
          },
          dispose() {},
        };
      },
    },
  });
  await adapter.run({ model: "a", input: "one" });
  await adapter.runValidation({ model: "a", input: "validation" });
  size = 8192;
  await adapter.run({
    model: "a",
    input: "parent",
    tools: {
      check: {
        async handler() {
          size = 4096;
          await assert.rejects(adapter.runValidation({ model: "a" }), /not ready/);
          size = 8192;
          await adapter.runValidation({ model: "a" });
          return "ok";
        },
      },
    },
  });
  await adapter.dispose();
  assert.deepEqual(events, [
    "create:16384",
    "shift:function",
    "create:16384",
    "shift:function",
    "dispose:16384",
    "create:8192",
    "shift:function",
    "dispose:16384",
    "create:8192",
    "shift:function",
    "dispose:8192",
    "dispose:8192",
    "model-dispose",
  ]);
});

test("input budget persists per model and can be reset", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xarab-budget-"));
  try {
    const file = path.join(dir, "config.json");
    const store = createSingleConfigStore(file);
    await store.load();
    const model = path.join(dir, "a.gguf");
    await assert.rejects(store.setModelInputBudget(model, 0), /positive safe integer/);
    await store.setModelInputBudget(model, 1000);
    const loaded = createSingleConfigStore(file);
    await loaded.load();
    assert.equal(loaded.getModel(model).inputBudget, 1000);
    assert.equal(loaded.getModel(path.join(dir, "b.gguf")).inputBudget, undefined);
    await loaded.setModelInputBudget(model, undefined);
    assert.equal(loaded.getModel(model).inputBudget, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local budget checks initial input and accumulated tool output", async () => {
  let budget;
  let loads = 0;
  let toolRuns = 0;
  const adapter = createLocalLlamaWorkerAdapter({
    contextSize: 500,
    getInputBudget: () => budget,
    modelRuntime: {
      async getLlama() {
        loads++;
        return {
          async loadModel() {
            return {
              async createContext() {
                return { getSequence: () => ({ clearHistory() {}, dispose() {} }) };
              },
              dispose() {},
            };
          },
        };
      },
      createSession() {
        return {
          async prompt(input, { functions, onTextChunk }) {
            if (!functions.test) return;
            await functions.test.handler({});
            if (input === "multiple") {
              onTextChunk("x".repeat(140));
              await functions.test.handler({});
            }
          },
          dispose() {},
        };
      },
    },
  });
  await assert.rejects(adapter.run({ model: "a", input: "x".repeat(500) }), /425 available/);
  assert.equal(loads, 1);
  budget = 450;
  await adapter.run({ model: "a", input: "x".repeat(400) });
  budget = 70;
  await assert.rejects(
    adapter.run({ model: "a", input: "hi", tools: { test: { handler: () => "x".repeat(400) } } }),
    /Tool continuation for local.*input budget/,
  );
  budget = 130;
  await assert.rejects(
    adapter.run({
      model: "a",
      input: "multiple",
      tools: {
        test: {
          handler: () => {
            toolRuns++;
            return "ok";
          },
        },
      },
    }),
    /Tool continuation for local.*input budget/,
  );
  assert.equal(toolRuns, 1);
  await adapter.dispose();
});
