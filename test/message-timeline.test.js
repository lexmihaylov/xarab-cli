import test from "node:test";
import assert from "node:assert/strict";
import { createMessageTimeline } from "../src/agent/message-timeline.js";

test("concurrent webfetch events settle the matching call, including errors", () => {
  const messages = [];
  const parts = ["first", "second", "third"].map((callId) => ({
    type: "tool",
    toolName: "webfetch",
    callId,
    label: `Fetching ${callId}`,
    params: { url: `https://${callId}.example` },
    status: "running",
  }));
  const timeline = createMessageTimeline({
    getMessages: () => messages,
    getCurrentAgentMessage: () => ({ parts }),
    getActiveSession: () => ({}),
    sessionChanged: () => {},
    notify: () => {},
  });

  timeline.onToolEvent("webfetch", { type: "fetched", callId: "second", bytes: 42 });
  assert.equal(parts[0].status, "running");
  assert.equal(parts[1].status, "complete");
  assert.equal(parts[1].summary, "Fetched 42 bytes");
  assert.equal(parts[2].status, "running");

  timeline.onToolEvent("webfetch", { type: "error", callId: "first", message: "HTTP 500" });
  assert.equal(parts[0].status, "error");
  assert.equal(parts[0].summary, "HTTP 500");
  assert.equal(parts[2].status, "running");
  assert.deepEqual(messages, []);

  timeline.onToolEvent("webfetch", {
    type: "error",
    callId: "unknown",
    path: "https://unknown.example",
    message: "network failure",
  });
  assert.equal(parts[2].status, "running");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].severity, "error");
  assert.equal(messages[0].message, "webfetch failed for https://unknown.example: network failure");

  timeline.onToolEvent("webfetch", { type: "fetched", callId: "third", bytes: 7 });
  assert.equal(parts[2].status, "complete");
  assert.equal(parts[2].summary, "Fetched 7 bytes");
});

test("command output updates only the matching running call", () => {
  const parts = ["first", "second"].map((callId) => ({
    type: "tool",
    toolName: "run_command",
    callId,
    status: "running",
    summary: "Executing command",
  }));
  const timeline = createMessageTimeline({
    getMessages: () => [],
    getCurrentAgentMessage: () => ({ parts }),
    getActiveSession: () => ({}),
    sessionChanged: () => {},
    notify: () => {},
  });
  timeline.onToolEvent("run_command", { type: "started", callId: "second", command: "test" });
  timeline.onToolEvent("run_command", { type: "output", callId: "second", text: "hello\n" });
  assert.equal(parts[0].summary, "Executing command");
  assert.equal(parts[1].summary, "hello\n");
  assert.equal(parts[1].status, "running");
});

test("unmatched success events are ignored while standalone errors remain visible", () => {
  const messages = [];
  const timeline = createMessageTimeline({
    getMessages: () => messages,
    getCurrentAgentMessage: () => ({ parts: [] }),
    getActiveSession: () => ({}),
    sessionChanged: () => {},
    notify: () => {},
  });
  timeline.onToolEvent("webfetch", { type: "fetched", url: "https://example.com", bytes: 10 });
  assert.deepEqual(messages, []);
  timeline.onToolEvent("mcp", { type: "error", path: "connection", message: "disconnected" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, "mcp failed for connection: disconnected");
  assert.equal(messages[0].severity, "error");
});
