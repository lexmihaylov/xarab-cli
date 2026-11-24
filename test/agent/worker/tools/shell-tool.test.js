import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createShellTool } from "../../../../src/agent/worker/tools/shell-tool.js";
test("streams command output before completion and flushes it before the completed event", async () => {
  const events = [];
  const tool = createShellTool({
    assessCommand: async () => ({ risk: "low", scope: "workspace", reason: "Test fixture" }),
    onEvent: (event) => events.push(event),
  });
  const result = await tool.handler({
    command: `node -e "process.stdout.write('first'); setTimeout(() => process.stderr.write('last'), 200)"`,
  });
  assert.equal(events[0].type, "started");
  assert.equal(events.at(-1).type, "completed");
  const outputEvents = events.filter((event) => event.type === "output");
  assert.ok(outputEvents.length >= 2);
  assert.equal(outputEvents.map((event) => event.text).join(""), "firstlast");
  assert.equal(events.at(-1).stdout, "first");
  assert.equal(events.at(-1).stderr, "last");
  assert.match(result, /Exit code: 0/);
});

test("runs a command from the workspace", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "xarab-agent-shell-"));
  try {
    const tool = createShellTool({
      workspace,
      assessCommand: async () => ({ risk: "low", scope: "workspace", reason: "Test fixture" }),
    });
    const result = await tool.handler({ command: "pwd" });
    assert.match(result, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result, /Exit code: 0/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("compacts verbose command output while retaining relevant error lines", async () => {
  const tool = createShellTool({
    assessCommand: async () => ({ risk: "low", scope: "workspace", reason: "Test fixture" }),
  });
  const result = await tool.handler({
    command: `node -e "for(let i=0;i<500;i++) console.log(i===300?'ERROR important failure':'noise '.repeat(20))"`,
  });
  assert.match(result, /ERROR important failure/);
  assert.match(result, /lines; .* omitted/);
  assert.ok(Buffer.byteLength(result) <= 8 * 1024);
});
