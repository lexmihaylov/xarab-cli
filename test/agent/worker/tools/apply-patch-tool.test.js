import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApplyPatchTool } from "../../../../src/agent/worker/tools/apply-patch-tool.js";

async function withWorkspace(run) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "xarab-patch-"));
  try {
    await run(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test("applies grouped updates, creation and deletion with previews", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "a"), "one\ntwo\nthree\n");
    await writeFile(path.join(workspace, "gone"), "old\n");
    const events = [];
    const tool = createApplyPatchTool({ workspace, onEvent: (event) => events.push(event) });
    const result = await tool.handler({
      patch:
        "*** Begin Patch\n*** Update File: a\n@@\n one\n-two\n+TWO\n@@\n-three\n+THREE\n*** Add File: dir/new\n+hello\n*** Delete File: gone\n*** End Patch",
    });
    assert.match(result, /Applied patch to 3/);
    assert.equal(await readFile(path.join(workspace, "a"), "utf8"), "one\nTWO\nTHREE\n");
    assert.equal(await readFile(path.join(workspace, "dir/new"), "utf8"), "hello\n");
    await assert.rejects(readFile(path.join(workspace, "gone")), { code: "ENOENT" });
    assert.deepEqual(
      events.map((event) => event.type),
      ["edited", "written", "deleted"],
    );
    assert.match(events[0].diffText, /\+TWO/);
  });
});

test("updates CRLF and mixed line endings without changing unaffected terminators", async () => {
  await withWorkspace(async (workspace) => {
    const cases = [
      { original: "one\r\ntwo\r\nthree\r\n", hunk: " one\n-two\n+TWO\n three", expected: "one\r\nTWO\r\nthree\r\n" },
      { original: "one\r\ntwo\nthree\r\n", hunk: " one\n-two\n+TWO\n three", expected: "one\r\nTWO\r\nthree\r\n" },
      { original: "one\r\ntwo\nthree\r\n", hunk: "@@ one\n-two\n+TWO", expected: "one\r\nTWO\nthree\r\n", anchored: true },
      { original: "one\r\ntwo\r\n", hunk: " one\n+new\n two", expected: "one\r\nnew\r\ntwo\r\n" },
    ];
    const tool = createApplyPatchTool({ workspace });
    for (const { original, hunk, expected, anchored } of cases) {
      await writeFile(path.join(workspace, "a"), original);
      const result = await tool.handler({ patch: `*** Begin Patch\n*** Update File: a\n${anchored ? "" : "@@\n"}${hunk}\n*** End Patch` });
      assert.notEqual(result.ok, false, result.output);
      assert.equal(await readFile(path.join(workspace, "a"), "utf8"), expected);
    }
  });
});

test("preserves final newline state and preceding terminator when deleting the last line", async () => {
  await withWorkspace(async (workspace) => {
    const cases = [
      { original: "first\r\nlast", hunk: "-last", expected: "first\r\n" },
      { original: "first\nlast", hunk: "-last\n+LAST", expected: "first\nLAST" },
      { original: "first\r\nlast\r\n", hunk: "-last\n+LAST", expected: "first\r\nLAST\r\n" },
      { original: "first\nlast", hunk: " last\n+new", expected: "first\nlast\nnew" },
      { original: "only", hunk: "-only", expected: "" },
    ];
    const tool = createApplyPatchTool({ workspace });
    for (const { original, hunk, expected } of cases) {
      await writeFile(path.join(workspace, "a"), original);
      const result = await tool.handler({ patch: `*** Begin Patch\n*** Update File: a\n@@\n${hunk}\n*** End of File\n*** End Patch` });
      assert.notEqual(result.ok, false, result.output);
      assert.equal(await readFile(path.join(workspace, "a"), "utf8"), expected);
    }
  });
});

test("prevalidates every section and rejects mismatches without writes", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "a"), "old\n");
    const tool = createApplyPatchTool({ workspace });
    const result = await tool.handler({
      patch:
        "*** Begin Patch\n*** Add File: dir/new\n+x\n*** Update File: a\n@@\n-Old\n+new\n*** End Patch",
    });
    assert.equal(result.ok, false);
    assert.match(result.output, /hunk does not match.*No files applied/s);
    await assert.rejects(readFile(path.join(workspace, "dir/new")), { code: "ENOENT" });
    assert.equal(await readFile(path.join(workspace, "a"), "utf8"), "old\n");
  });
});

test("rejects traversal, symlinks, binary files, duplicate paths and malformed patches", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "a"), "old\n");
    await writeFile(path.join(workspace, "binary"), Buffer.from([0]));
    await symlink(path.join(workspace, "a"), path.join(workspace, "link"));
    const tool = createApplyPatchTool({ workspace });
    for (const patch of [
      "*** Begin Patch\n*** Add File: ../escape\n+x\n*** End Patch",
      "*** Begin Patch\n*** Delete File: link\n*** End Patch",
      "*** Begin Patch\n*** Delete File: binary\n*** End Patch",
      "*** Begin Patch\n*** Delete File: a\n*** Delete File: ./a\n*** End Patch",
      "*** Begin Patch\n*** Add File: x\nnot added\n*** End Patch",
    ]) {
      const result = await tool.handler({ patch });
      assert.equal(result.ok, false);
      assert.match(result.output, /^Error/);
    }
    assert.equal(await readFile(path.join(workspace, "a"), "utf8"), "old\n");
  });
});

test("reports already applied files when a later commit fails", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(path.join(workspace, "a"), "a\n");
    await writeFile(path.join(workspace, "b"), "b\n");
    const tool = createApplyPatchTool({
      workspace,
      onEvent: (event) => {
        if (event.type === "edited") throw new Error("observer failed");
      },
    });
    const result = await tool.handler({
      patch: "*** Begin Patch\n*** Update File: a\n@@\n-a\n+A\n*** Delete File: b\n*** End Patch",
    });
    assert.equal(result.ok, false);
    assert.match(result.output, /Already applied: a/);
    assert.equal(await readFile(path.join(workspace, "a"), "utf8"), "A\n");
    assert.equal(await readFile(path.join(workspace, "b"), "utf8"), "b\n");
  });
});
