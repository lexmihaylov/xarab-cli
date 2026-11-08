import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEditTool } from "../../../../src/agent/worker/tools/edit-tool.js";
import { createInsertTool } from "../../../../src/agent/worker/tools/insert-tool.js";
import { findText } from "../../../../src/utils/workspace-file-utils.js";

test("normalized ranges count supplementary characters as UTF-16 units", () => {
  assert.deepEqual(findText("😀\r\nEND", "😀\n"), { index: 0, length: 4 });
  assert.deepEqual(findText("😀\r\nA😀\r\nEND", "A😀\n"), { index: 4, length: 5 });
});

test("normalized emoji edits preserve unrelated bytes for unique and replace-all edits", async () => {
  await withWorkspace(async (workspace) => {
    const target = path.join(workspace, "emoji.txt");
    const tool = createEditTool({ workspace });
    for (const replaceAll of [false, true]) {
      await writeFile(target, replaceAll ? "😀\r\n😀\r\nEND" : "😀\r\nEND");
      assert.match(
        await tool.handler({ path: "emoji.txt", oldString: "😀\n", newString: "X", replaceAll }),
        /Edited/,
      );
      assert.equal(await readFile(target, "utf8"), replaceAll ? "XXEND" : "XEND");
    }
  });
});

async function withWorkspace(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-edit-tool-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("replaces a unique exact string and reports the edit", async () => {
  await withWorkspace(async (workspace) => {
    const target = path.join(workspace, "file.txt");
    await writeFile(target, "before\nold value\nafter\n");
    const events = [];
    const tool = createEditTool({ workspace, onEvent: (event) => events.push(event) });

    assert.match(
      await tool.handler({ path: "file.txt", oldString: "old value", newString: "new value" }),
      /Edited file\.txt/,
    );
    assert.equal(await readFile(target, "utf8"), "before\nnew value\nafter\n");
    assert.equal(events[0].type, "edited");
    assert.equal(events[0].path, "file.txt");
    assert.equal(events[0].replacements, 1);
    assert.match(events[0].diffText, /-old value/);
    assert.match(events[0].diffText, /\+new value/);
  });
});

test("matches exact-read LF excerpts against CRLF files and preserves remaining bytes", async () => {
  await withWorkspace(async (workspace) => {
    const target = path.join(workspace, "crlf.txt");
    await writeFile(target, "before\r\nold value\r\nafter\r\n");
    const tool = createEditTool({ workspace });

    assert.match(
      await tool.handler({
        path: "crlf.txt",
        oldString: "old value\nafter",
        newString: "new value\nafter",
      }),
      /Edited crlf\.txt/,
    );
    assert.equal(await readFile(target, "utf8"), "before\r\nnew value\nafter\r\n");
  });
});

test("requires a unique match unless replaceAll is true", async () => {
  await withWorkspace(async (workspace) => {
    const target = path.join(workspace, "file.txt");
    await writeFile(target, "same\nsame\n");
    const tool = createEditTool({ workspace });

    assert.match(
      await tool.handler({ path: "file.txt", oldString: "same", newString: "other" }),
      /must match exactly once/,
    );
    assert.equal(await readFile(target, "utf8"), "same\nsame\n");
    assert.match(
      await tool.handler({
        path: "file.txt",
        oldString: "same",
        newString: "other",
        replaceAll: true,
      }),
      /2 replacements/,
    );
    assert.equal(await readFile(target, "utf8"), "other\nother\n");
  });
});

test("reports absent text and rejects unsafe targets", async () => {
  await withWorkspace(async (workspace) => {
    const outside = path.join(path.dirname(workspace), `${path.basename(workspace)}-outside.txt`);
    await writeFile(outside, "private");
    await writeFile(path.join(workspace, "file.txt"), "present");
    await symlink(outside, path.join(workspace, "linked.txt"));
    const tool = createEditTool({ workspace });
    try {
      assert.match(
        await tool.handler({ path: "missing.txt", oldString: "x", newString: "y" }),
        /does not exist/,
      );
      assert.match(
        await tool.handler({ path: "file.txt", oldString: "x", newString: "y" }),
        /was not found/,
      );
      assert.match(
        await tool.handler({ path: "../secret.txt", oldString: "x", newString: "y" }),
        /outside the workspace/,
      );
      assert.match(
        await tool.handler({ path: "linked.txt", oldString: "x", newString: "y" }),
        /Symbolic-link/,
      );
    } finally {
      await rm(outside, { force: true });
    }
  });
});

test("shared mismatch diagnostics are bounded and allow exact recovery", async () => {
  await withWorkspace(async (workspace) => {
    const target = path.join(workspace, "file.txt");
    const original = "  target\n".repeat(20);
    const events = [];
    const edit = createEditTool({ workspace, onEvent: (event) => events.push(event) });
    const insert = createInsertTool({
      workspace,
      position: "before",
      onEvent: (event) => events.push(event),
    });
    await writeFile(target, original);
    for (const [tool, args] of [
      [edit, { oldString: " target", newString: "changed" }],
      [insert, { anchor: " target", content: "changed" }],
    ]) {
      // A substring is an exact match; use a whitespace mismatch instead.
      const mismatch =
        tool === edit ? { ...args, oldString: "   target" } : { ...args, anchor: "   target" };
      const result = await tool.handler({ path: "file.txt", ...mismatch });
      assert.match(result, /Possible whitespace-only first-line candidates/);
      assert.match(result, /line 1:/);
      assert.doesNotMatch(result, /line 4:/);
      assert.equal(await readFile(target, "utf8"), original);
    }
    const duplicate = await edit.handler({
      path: "file.txt",
      oldString: "target",
      newString: "changed",
    });
    assert.match(duplicate, /Match locations: line 1, line 2/);
    assert.doesNotMatch(duplicate, /line 6/);
    assert.equal(events.length, 0);
    await writeFile(target, "before\n  target\nafter\n");
    assert.match(
      await edit.handler({ path: "file.txt", oldString: "  target", newString: "changed" }),
      /Edited/,
    );
    assert.match(
      await insert.handler({ path: "file.txt", anchor: "changed", content: "inserted" }),
      /Inserted/,
    );
    assert.equal(await readFile(target, "utf8"), "before\ninserted\nchanged\nafter\n");
  });
});
test("documents OpenCode-style exact-string edit semantics", async () => {
  await withWorkspace(async (workspace) => {
    const tool = createEditTool({ workspace });
    assert.match(tool.description, /oldString must match exactly once unless replaceAll is true/);
    assert.match(tool.description, /entire oldString/);
    assert.deepEqual(tool.params.required, ["path", "oldString", "newString"]);
  });
});
