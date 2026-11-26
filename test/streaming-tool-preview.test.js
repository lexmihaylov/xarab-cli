import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createAssistantController } from "../src/agent/controller/index.js";
import { createToolTimelineObserver } from "../src/agent/worker/tool-timeline-observer.js";

test("tool observer adopts only the preview with the matching call ID", async () => {
  const message = {
    parts: [
      { type: "tool", id: Symbol(), preview: true, callId: "a", status: "running" },
      { type: "tool", id: Symbol(), preview: true, callId: "b", status: "running" },
    ],
  };
  const observer = createToolTimelineObserver({
    getMessages: () => [message],
    getCurrentAgentMessage: () => message,
    sessionChanged() {},
    notify() {},
  });
  const original = message.parts[1];
  const part = await observer.start("read_file", { path: "file" }, "b");
  assert.equal(part, original);
  assert.equal(message.parts.length, 2);
  assert.equal(part.preview, undefined);
  observer.complete(part, "read_file", { path: "file" }, { ok: true, output: "ok" });
  assert.equal(part.status, "complete");
  await observer.start("read_file", {}, "c");
  assert.equal(message.parts.length, 3);
});

test("task timeline records execution intervals for successful and failed calls", async () => {
  const message = { parts: [] };
  const observer = createToolTimelineObserver({
    getMessages: () => [message],
    getCurrentAgentMessage: () => message,
    sessionChanged() {},
    notify() {},
  });
  const first = await observer.start("task", {}, "first");
  const second = await observer.start("task", {}, "second");
  observer.complete(first, "task", {}, { ok: true, output: "done" });
  observer.fail(second, { ok: false, output: "failed" });
  assert.ok(Number.isSafeInteger(first.taskStartedAt));
  assert.ok(first.taskFinishedAt >= second.taskStartedAt);
  assert.ok(second.taskFinishedAt >= second.taskStartedAt);
  const ordinary = await observer.start("read_file", {}, "ordinary");
  observer.complete(ordinary, "read_file", {}, { ok: true, output: "done" });
  assert.equal(ordinary.taskStartedAt, undefined);
  assert.equal(ordinary.taskFinishedAt, undefined);
});

test("controller streams bounded previews, reconciles calls, and settles abandoned previews", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-preview-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let live;
  const controller = createAssistantController({
    mode: "single",
    automaticTitles: false,
    automaticSuggestions: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
    classifierFactory: () => ({
      load: async () => {},
      dispose: async () => {},
      classify: async () => ({ valid: true, tier: 1, rationale: "Routine" }),
    }),
    localWorkerAdapterFactory: () => ({
      dispose: async () => {},
      run: async ({ onEvent, tools }) => {
        onEvent({
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "item", call_id: "call", name: "list_files" },
        });
        onEvent({ type: "tool_call_started", itemId: "item", outputIndex: 0, name: "list_files" });
        onEvent({
          type: "tool_call_delta",
          itemId: "item",
          outputIndex: 0,
          delta: "x".repeat(5000),
        });
        live = controller.getState().messages.find((m) => m.type === "agent").parts[0]
          .previewArguments.length;
        onEvent({
          type: "response.completed",
          response: { output: [{ type: "function_call", id: "item", call_id: "call" }] },
        });
        await tools.list_files.handler({ path: "." }, { callId: "call" });
        onEvent({
          type: "tool_call_started",
          itemId: "unfinished",
          outputIndex: 0,
          name: "read_file",
        });
        throw new Error("incomplete stream");
      },
    }),
  });
  await controller.initialize();
  t.after(() => controller.shutdown());
  await controller.setSingleModel({ provider: "local", model: "small.gguf" });
  await controller.submit("inspect");
  const parts = controller.getState().messages.find((m) => m.type === "agent").parts;
  assert.equal(live, 4096);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].callId, "call");
  assert.equal(parts[0].status, "complete");
  assert.equal(parts[1].status, "error");
});

test("retry settles old previews before new events and does not reuse their call IDs", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-retry-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let controller;
  let retrySnapshot;
  let resumedStatus;
  controller = createAssistantController({
    mode: "single",
    automaticTitles: false,
    automaticSuggestions: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
    classifierFactory: () => ({
      load: async () => {},
      dispose: async () => {},
      classify: async () => ({ valid: true, tier: 1, rationale: "Routine" }),
    }),
    localWorkerAdapterFactory: () => ({
      dispose: async () => {},
      run: async ({ onEvent, tools }) => {
        onEvent({
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "old", call_id: "old-call" },
        });
        onEvent({ type: "tool_call_delta", itemId: "old", outputIndex: 0, delta: "old" });
        onEvent({
          type: "provider_retry",
          provider: "Test",
          reason: "empty_response",
          attempt: 1,
          maxRetries: 2,
        });
        const state = controller.getState();
        const old = state.messages.find((message) => message.type === "agent").parts[0];
        retrySnapshot = { status: state.status, toolStatus: old.status, title: old.title };
        onEvent({ type: "tool_call_started", itemId: "new", outputIndex: 0, name: "list_files" });
        resumedStatus = controller.getState().status;
        onEvent({
          type: "response.completed",
          response: { output: [{ type: "function_call", id: "new", call_id: "new-call" }] },
        });
        await tools.list_files.handler({ path: "." }, { callId: "new-call" });
      },
    }),
  });
  await controller.initialize();
  t.after(() => controller.shutdown());
  await controller.setSingleModel({ provider: "local", model: "small.gguf" });
  await controller.submit("inspect");
  const parts = controller.getState().messages.find((message) => message.type === "agent").parts;
  assert.match(retrySnapshot.status, /was empty; retrying \(1\/2\)/);
  assert.equal(retrySnapshot.toolStatus, "error");
  assert.equal(retrySnapshot.title, "Tool call not executed");
  assert.equal(resumedStatus, "Worker generating…");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].callId, "old-call");
  assert.equal(parts[0].status, "error");
  assert.equal(parts[1].callId, "new-call");
  assert.equal(parts[1].status, "complete");
});
