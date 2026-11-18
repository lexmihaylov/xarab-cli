---
name: skill-creator
description: Guide creation and maintenance of reusable Xarab agent skills.
---

When asked to create or update a skill:
1. Clarify its purpose, when it should be used, and whether it belongs to the project or the user. Follow the user's requested scope and Xarab's approval workflow before making changes.
2. Choose a concise name using lowercase letters, digits, and single hyphens, at most 64 characters. Use the same name for the skill directory and the `name` field.
3. Create `SKILL.md` under `.agents/skills/<name>/` in the workspace for a project skill, or `~/.agents/skills/<name>/` for a personal skill if the available tools and permissions allow it. Do not assume workspace file tools can write outside the workspace.
4. Start the file with `---` frontmatter containing single-line `name` and `description` fields, followed by `---`. Make the description explain when the skill is useful. Keep it within 1024 characters and the whole file within 64 KiB.
5. Write focused, actionable instructions, including relevant checks and boundaries. Skill instructions do not override higher-priority instructions or approval requirements. Prefer self-contained instructions: supporting files outside the workspace cannot currently be read with the workspace file tools.
6. Verify the directory name, frontmatter, size, and intended discovery location. Project and personal skills take precedence over built-in skills with the same name. Explain how to invoke the skill by its exact name.
