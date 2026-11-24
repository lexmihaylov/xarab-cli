import test from "node:test";
import assert from "node:assert/strict";
import { runShellCommand } from "../../../../src/agent/worker/tools/shell-command-executor.js";
test("streams split UTF-8 sequences without corrupting either stream", async () => {
  const chunks = [];
  const result = await runShellCommand(
    `node -e "process.stdout.write(Buffer.from([0xe2])); process.stderr.write(Buffer.from([0xc3])); setTimeout(() => { process.stdout.write(Buffer.from([0x82,0xac])); process.stderr.write(Buffer.from([0xa9])); }, 100)"`,
    { onOutput: (stream, text) => chunks.push({ stream, text }) },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "€");
  assert.equal(result.stderr, "é");
  assert.equal(
    chunks
      .filter((chunk) => chunk.stream === "stdout")
      .map((chunk) => chunk.text)
      .join(""),
    "€",
  );
  assert.equal(
    chunks
      .filter((chunk) => chunk.stream === "stderr")
      .map((chunk) => chunk.text)
      .join(""),
    "é",
  );
});

test("streamed output respects the shared capture cap", async () => {
  const chunks = [];
  const result = await runShellCommand("node -e \"process.stdout.write('x'.repeat(1000))\"", {
    maxOutputBytes: 100,
    onOutput: (stream, text) => chunks.push({ stream, text }),
  });
  assert.equal(result.truncated, true);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), result.stdout + result.stderr);
  assert.equal(Buffer.byteLength(chunks.map((chunk) => chunk.text).join("")), 100);
});
test("parent cancellation stops a command and pre-cancellation prevents spawning", async () => {
  const controller = new AbortController();
  const pending = runShellCommand("sleep 20", { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).cancelled, true);
  const result = await runShellCommand("printf should-not-run", { signal: controller.signal });
  assert.equal(result.stdout, "");
  assert.equal(result.cancelled, true);
});

test("runs a user-provided local command and captures stdout/stderr", async () => {
  const result = await runShellCommand("printf 'hello'; printf 'note' >&2; exit 3", {
    timeoutMs: 2_000,
  });
  assert.equal(result.code, 3);
  assert.equal(result.stdout, "hello");
  assert.equal(result.stderr, "note");
  assert.equal(result.timedOut, false);
});

test("bounds command output and marks truncation", async () => {
  const result = await runShellCommand("node -e \"process.stdout.write('x'.repeat(1000))\"", {
    maxOutputBytes: 100,
    timeoutMs: 2_000,
  });
  assert.equal(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), 100);
  assert.equal(result.truncated, true);
});

test("terminates commands that exceed the timeout", async () => {
  const result = await runShellCommand("sleep 2", { timeoutMs: 30 });
  assert.equal(result.timedOut, true);
});
