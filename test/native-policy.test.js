import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorizeNativeTool } from "../src/agent/native-policy.js";
import { parsePolicy } from "../src/agent/command-policy.js";
import { authorizeCommand } from "../src/agent/command-risk.js";
import { createToolRegistry } from "../src/agent/worker/tool-registry.js";
import { writeFile } from "node:fs/promises";
test("registered native tools enforce activated policy before accessing content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "registry-policy-"));
  try {
    await mkdir(path.join(workspace, ".xarab"));
    await writeFile(path.join(workspace, "secret.txt"), "do not disclose");
    await writeFile(
      path.join(workspace, ".xarab/command-policy.json"),
      JSON.stringify({ version: 1, files: { "secret.txt": "deny" } }),
    );
    const { tools } = createToolRegistry({
      workspace,
      onToolEvent: () => {},
      getMessages: () => [],
      getCurrentAgentMessage: () => undefined,
      sessionChanged: () => {},
      notify: () => {},
      requestQuestions: async () => ({
        cancelled: false,
        answers: [{ id: "workspace_policy", choices: ["Approve"] }],
      }),
    });
    const result = await tools.read_file.handler({ path: "secret.txt" });
    assert.equal(result.ok, false);
    assert.match(result.output, /workspace policy/);
    assert.doesNotMatch(result.output, /do not disclose/);
    for (const name of ["search_content", "search_files", "list_files"]) {
      for (const target of [" . ", "", "   "]) {
        const blocked = await tools[name].handler({ path: target, query: "do not disclose" });
        assert.equal(blocked.ok, false, `${name}: ${JSON.stringify(target)}`);
        assert.match(blocked.output, /workspace policy/);
        assert.doesNotMatch(blocked.output, /secret.txt|do not disclose/);
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("registered apply_patch authorizes every operation before making changes", async (t) => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: update.txt",
    "@@",
    "-old",
    "+new",
    "*** Add File: added.txt",
    "+added",
    "*** Delete File: deleted.txt",
    "*** End Patch",
  ].join("\n");

  for (const [target, action, decision] of [
    ["update.txt", "deny", "Approve"],
    ["added.txt", "deny", "Approve"],
    ["deleted.txt", "deny", "Approve"],
    ["added.txt", "verify", "Deny"],
    ["deleted.txt", "verify", "Approve"],
  ]) {
    await t.test(`${target} ${action} ${decision}`, async () => {
      const workspace = await mkdtemp(path.join(os.tmpdir(), "patch-policy-"));
      try {
        await mkdir(path.join(workspace, ".xarab"));
        await writeFile(path.join(workspace, "update.txt"), "old\n");
        await writeFile(path.join(workspace, "deleted.txt"), "delete me\n");
        await writeFile(
          path.join(workspace, ".xarab/command-policy.json"),
          JSON.stringify({ version: 1, files: { [target]: action } }),
        );
        const questions = [];
        const events = [];
        const { definitions, tools } = createToolRegistry({
          workspace,
          onToolEvent: (name, event) => events.push({ name, ...event }),
          getMessages: () => [],
          getCurrentAgentMessage: () => undefined,
          sessionChanged: () => {},
          notify: () => {},
          requestQuestions: async ([question]) => {
            questions.push(question.question);
            return {
              cancelled: false,
              answers: [
                {
                  id: "workspace_policy",
                  choices: [questions.length === 1 ? "Approve" : decision],
                },
              ],
            };
          },
        });
        assert.equal(typeof definitions.apply_patch.handler, "function");
        assert.equal(typeof tools.apply_patch.handler, "function");
        const result = await tools.apply_patch.handler({ patch }, { callId: "patch-call" });
        const approved = action === "verify" && decision === "Approve";
        assert.equal(result.ok, approved);
        assert.equal(questions.length, action === "verify" ? 2 : 1);
        if (action === "verify") {
          for (const file of ["update.txt", "added.txt", "deleted.txt"]) {
            assert.ok(questions[1].includes(file));
          }
        }
        if (approved) {
          assert.equal(await readFile(path.join(workspace, "update.txt"), "utf8"), "new\n");
          assert.equal(await readFile(path.join(workspace, "added.txt"), "utf8"), "added\n");
          await assert.rejects(readFile(path.join(workspace, "deleted.txt")), { code: "ENOENT" });
          assert.ok(
            events.every((event) => event.name === "apply_patch" && event.callId === "patch-call"),
          );
          assert.equal(events.length, 3);
        } else {
          assert.match(result.output, /workspace policy/);
          assert.equal(await readFile(path.join(workspace, "update.txt"), "utf8"), "old\n");
          assert.equal(await readFile(path.join(workspace, "deleted.txt"), "utf8"), "delete me\n");
          await assert.rejects(readFile(path.join(workspace, "added.txt")), { code: "ENOENT" });
          assert.deepEqual(events, []);
        }
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    });
  }
});

test("native checks cover ancestors, symlink aliases, images and approval", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "native-policy-"));
  try {
    await mkdir(path.join(workspace, "private"));
    await symlink("private", path.join(workspace, "alias"));
    const policy = parsePolicy(
      JSON.stringify({
        version: 1,
        folders: { private: "deny", reviewed: "verify" },
        files: { "public.txt": "allow" },
      }),
    );
    const check = (name, params, requestQuestions) =>
      authorizeNativeTool({ workspace, policy, name, params, requestQuestions });
    assert.equal(await check("read_file", { path: "private/key" }), false);
    assert.equal(await check("write", { path: "alias/new" }), false);
    for (const name of ["search_content", "search_files", "list_files"])
      assert.equal(await check(name, {}), false);
    assert.equal(await check("generate_image", { folder: "private" }), false);
    assert.equal(await check("edit_image", { path: "private/input.png", folder: "public" }), false);
    assert.equal(await check("read_file", { path: "public.txt" }), true);
    assert.equal(await check("write", { path: "reviewed/new" }), false);
    assert.equal(
      await check("write", { path: "reviewed/new" }, async () => ({
        cancelled: false,
        answers: [{ id: "workspace_policy", choices: ["Approve"] }],
      })),
      true,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("command policy denies before assessment and assesses unmatched group members", async () => {
  const policy = parsePolicy(
    JSON.stringify({
      version: 1,
      commands: { echo: "allow", rm: "deny" },
      folders: { private: "deny" },
    }),
  );
  const calls = [];
  const authorize = (command) =>
    authorizeCommand({
      command,
      workspace: process.cwd(),
      policy,
      assess: async ({ command }) => {
        calls.push(command);
        return { risk: "low", scope: "workspace", reason: "test" };
      },
    });
  assert.equal((await authorize("echo hello")).approved, true);
  assert.deepEqual(calls, []);
  assert.equal((await authorize("echo hello && rm file")).approved, false);
  assert.equal((await authorize("echo private/key")).approved, false);
  assert.equal((await authorize("echo hello && git status")).approved, true);
  assert.deepEqual(calls, ["git status"]);
});
