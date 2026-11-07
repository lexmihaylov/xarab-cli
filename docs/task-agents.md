# Task agents

The main Xarab worker can delegate a bounded task to an isolated agent through its `task` tool. Ask the assistant to use a profile by name and include the task, relevant context, constraints, and whether implementation is approved. The assistant decides whether to delegate; a profile is not a slash command. The built-in `general-purpose` profile is the default.

Each task starts with a clean conversation context, not the parent conversation. The calling worker supplies a brief and any selected context, so include anything the delegate needs to know. The task is classified independently and uses the configured worker for the selected tier; classification or configuration failures are reported rather than silently falling back. The classifier or worker may be remote and consume provider usage. Progress appears in the task card, and the result returns to the main worker.

## Create a project profile

Create `.agents/agents/investigate.md` in the workspace root:

```markdown
---
name: investigate
description: Investigate a problem and report findings
---

Investigate the supplied task. Preserve the user's constraints and report evidence, verification, and unresolved questions. Do not modify files unless the user has approved implementation.
```

Then, for example, ask: “Use the investigate task agent to find the cause of the failing tests; report findings only, without changing files.” Profiles are rediscovered when the task is invoked, so edits do not require a restart for discovery.

This is a Xarab-specific format, not a general YAML parser or a compatibility promise with other tools' agent formats:

- Only regular `.md` files directly in the workspace's `.agents/agents` directory are discovered, not symlink entries. Profiles are not searched in parent or home directories. The definition directory path itself must not resolve through symlinks.
- The filename, without `.md`, must match `name`. Names use lowercase ASCII letters and digits separated by single hyphens, with no leading or trailing hyphen, and are at most 64 characters. `general-purpose` is reserved for the built-in profile.
- Start with the exact frontmatter structure shown: `---`, then unquoted single-line `name` and `description` fields in that order, then `---`. No extra frontmatter fields are supported. The description is at most 1,024 characters; the body must contain non-whitespace instructions.
- Each file is limited to 64 KiB. The combined task brief, selected context, and profile instructions are additionally limited to 32 KiB at invocation.

Malformed or oversized profiles are reported and skipped without blocking other valid profiles or the built-in agent. An invalid filename or a reserved-name file is ignored. If a selected profile is missing or invalid, the task fails with an error. Directory-level discovery errors can prevent task invocation; check directory permissions and symlinks if discovery fails.

## Permissions and operation

Profiles supply instructions, not permissions or a sandbox. A profile cannot override user constraints or application policy, grant approval, select a model, or configure tool permissions. A “read-only” instruction is not a tool-enforced read-only boundary: task agents have access to existing permitted tools, including write-capable tools, subject to the normal authorization rules. Tasks cannot spawn further tasks. MCP servers must be explicitly selected for each task and remain subject to existing consent rules; see [MCP servers](mcp.md).

The parent can request independent tasks in parallel, but concurrency is not guaranteed. One agentic task may run per session at a time. A task using the shared local worker fails explicitly if that runtime is busy, including when a local parent is waiting for its child. Tasks do not have file isolation; avoid overlapping edits. Agentic tasks have no automatic deadline. Stopping the parent turn cancels its tasks cooperatively, but cancellation does not undo edits or other side effects and does not guarantee an uncooperative operation has stopped. Failed tasks may return partial output and bounded diagnostics; generated task output is limited to 16 KiB.
