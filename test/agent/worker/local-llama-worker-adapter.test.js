import test from "node:test";
import assert from "node:assert/strict";
import { createLocalLlamaWorkerAdapter } from "../../../src/agent/worker/local-llama-worker-adapter.js";

test("local worker releases its sequence after successful and failed turns", async () => {
  let reserved = false;
  let fail = false;
  let loads = 0;
  const adapter = createLocalLlamaWorkerAdapter({
    modelRuntime: {
      async getLlama() {
        return {
          async loadModel() {
            loads++;
            return {
              async createContext() {
                return {
                  getSequence() {
                    if (reserved) throw new Error("No sequences left");
                    reserved = true;
                    return {
                      clearHistory() {},
                      dispose() {
                        reserved = false;
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
      createSession({ contextShift }) {
        assert.equal(contextShift.size, 6144);
        if (fail) throw new Error("session creation failed");
        return { prompt: async () => "done", dispose() {} };
      },
    },
  });
  const request = { model: "model.gguf", input: "hello" };
  await adapter.run(request);
  await adapter.run(request);
  fail = true;
  await assert.rejects(adapter.run(request), /session creation failed/);
  fail = false;
  await adapter.run(request);
  assert.equal(loads, 1);
  assert.equal(reserved, false);
  await adapter.dispose();
});

test("local worker replays completed typed history without executing historical tools", async () => {
  let history;
  let prompt;
  let executions = 0;
  const sequence = { clearHistory() {} };
  const adapter = createLocalLlamaWorkerAdapter({
    modelRuntime: {
      async getLlama() {
        return {
          async loadModel() {
            return {
              async createContext() {
                return { getSequence: () => sequence };
              },
            };
          },
        };
      },
      createSession({ systemPrompt }) {
        return {
          getChatHistory: () => [{ type: "system", text: systemPrompt }],
          setChatHistory(value) {
            history = value;
          },
          async prompt(value) {
            prompt = value;
            return "done";
          },
        };
      },
    },
  });
  await adapter.run({
    model: "model.gguf",
    instructions: "system instructions",
    tools: {
      read_file: {
        handler() {
          executions++;
        },
      },
    },
    input: [
      { role: "user", content: "previous" },
      { role: "assistant", content: "before" },
      { type: "tool_call", name: "read_file", callId: "a", arguments: { path: "x" } },
      { type: "tool_call", name: "read_file", callId: "b", arguments: {} },
      { type: "tool_result", callId: "a", ok: true, output: "contents" },
      { type: "tool_result", callId: "b", ok: false, output: "denied" },
      { type: "tool_call", name: "read_file", callId: "incomplete", arguments: {} },
      { type: "tool_result", callId: "orphan", ok: true, output: "ignored" },
      { role: "assistant", content: "after" },
      { role: "user", content: "current" },
    ],
  });
  assert.equal(executions, 0);
  assert.equal(prompt, "current");
  assert.deepEqual(history, [
    { type: "system", text: "system instructions" },
    { type: "user", text: "previous" },
    {
      type: "model",
      response: [
        "before",
        { type: "functionCall", name: "read_file", params: { path: "x" }, result: "contents" },
        { type: "functionCall", name: "read_file", params: {}, result: "Error: denied" },
        "after",
      ],
    },
  ]);
  await adapter.dispose();
});

test("local worker rejects ambiguous and cross-turn tool pairs and executes live tools", async () => {
  let history;
  const events = [];
  const executions = [];
  const sequence = { clearHistory() {} };
  const adapter = createLocalLlamaWorkerAdapter({
    modelRuntime: {
      async getLlama() {
        return {
          loadModel: async () => ({ createContext: async () => ({ getSequence: () => sequence }) }),
        };
      },
      createSession() {
        return {
          getChatHistory: () => [{ type: "system", text: "system" }],
          setChatHistory(value) {
            history = value;
          },
          async prompt(value, options) {
            assert.equal(value, "current");
            assert.equal(options.maxParallelFunctionCalls, 1);
            assert.equal(
              await options.functions.read_file.handler({ path: "live" }),
              "live result",
            );
            return "done";
          },
        };
      },
    },
  });
  await adapter.run({
    model: "model.gguf",
    onEvent: (event) => events.push(event),
    tools: {
      read_file: {
        handler(params, context) {
          executions.push({ params, context });
          return { ok: true, output: "live result" };
        },
      },
    },
    input: [
      { type: "tool_call", name: "read_file", callId: "dup" },
      { type: "tool_call", name: "read_file", callId: "dup" },
      { type: "tool_result", callId: "dup", ok: true, output: "ambiguous" },
      { type: "tool_call", name: "read_file", callId: "cross" },
      { role: "user", content: "boundary" },
      { type: "tool_result", callId: "cross", ok: true, output: "wrong turn" },
      { role: "user", content: "current" },
    ],
  });
  assert.deepEqual(history, [
    { type: "system", text: "system" },
    { type: "user", text: "boundary" },
  ]);
  assert.equal(executions.length, 1);
  assert.deepEqual(executions[0].params, { path: "live" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tool_call");
  assert.equal(events[0].callId, executions[0].context.callId);
  await adapter.dispose();
});
