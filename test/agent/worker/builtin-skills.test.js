import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverSkills } from "../../../src/agent/worker/skills.js";
import { createSkillTool } from "../../../src/agent/worker/tools/skill-tool.js";
test("npm package includes bundled skill definitions", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [pack] = JSON.parse(output);
  assert.ok(pack.files.some(({ path: file }) => file === "skills/skill-creator/SKILL.md"));
  assert.ok(pack.files.some(({ path: file }) => file === "skills/xarab-configuration/SKILL.md"));
  assert.ok(pack.files.some(({ path: file }) => file === "skills/xarab-command-policy/SKILL.md"));
  assert.ok(pack.files.some(({ path: file }) => file === "skills/xarab-mcp/SKILL.md"));
});

test("built-in skills load from any workspace and can be overridden", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-builtin-"));
  try {
    const workspace = path.join(root, "project");
    const home = path.join(root, "home");
    await mkdir(path.join(workspace, ".git"), { recursive: true });
    await mkdir(home);
    let skills = await discoverSkills(workspace, home);
    assert.match(
      await createSkillTool(skills).handler({ name: "skill-creator" }),
      /When asked to create/,
    );

    assert.match(
      await createSkillTool(skills).handler({ name: "xarab-command-policy" }),
      /not a sandbox/,
    );

    assert.match(await createSkillTool(skills).handler({ name: "xarab-mcp" }), /not sandboxed/);

    const globalDir = path.join(home, ".agents", "skills", "skill-creator");
    await mkdir(globalDir, { recursive: true });
    await writeFile(
      path.join(globalDir, "SKILL.md"),
      "---\nname: skill-creator\ndescription: Personal\n---\nPersonal instructions",
    );
    skills = await discoverSkills(workspace, home);
    assert.match(
      await createSkillTool(skills).handler({ name: "skill-creator" }),
      /Personal instructions/,
    );

    const projectDir = path.join(workspace, ".agents", "skills", "skill-creator");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, "SKILL.md"),
      "---\nname: skill-creator\ndescription: Project\n---\nProject instructions",
    );
    skills = await discoverSkills(workspace, home);
    assert.match(
      await createSkillTool(skills).handler({ name: "skill-creator" }),
      /Project instructions/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
