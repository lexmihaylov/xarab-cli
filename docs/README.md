# Xarab documentation

Find setup instructions in the [main README](../README.md), then use these guides for the features you need:

- [Configuration reference](./configuration.md) — settings, routing, environment variables, and storage.
- [Troubleshooting](./troubleshooting.md) — setup and runtime diagnostics.
- [Agent skills](./agent-skills.md) — discover and write reusable skills.
- [Task agents](./task-agents.md) — configure and use agent profiles for delegated work.
- [MCP servers](./mcp.md) — connect servers and understand approvals and security.
- [Command policy](./command-policy.md) — configure workspace authorization and understand its limitations.

## Design and planning records

These records document issues and proposals, not necessarily current behavior. Check each record's type and status before relying on it. The command policy guide is also an in-progress decision record.

| Record | Type | Status | Subject |
| --- | --- | --- | --- |
| [OpenAI response timeout recovery](./records/openai-response-timeout-recovery.md) | issue | deferred | Timeout and retry recovery for stalled responses |
| [Responses WebSocket fallback](./records/responses-websocket-fallback.md) | issue | deferred | HTTP fallback for rejected continuations |
| [Tier adjustment rejection](./records/tier-adjustment-rejection.md) | issue | deferred | Misleading no-suitable-tier rejection |
| [Cross-prompt Responses continuation](./records/cross-prompt-responses-continuation.md) | proposal | deferred | Reuse incremental continuation across prompts |
| [Parallel session orchestration](./records/parallel-session-orchestration.md) | proposal | deferred | Parallel sessions and task agent prerequisite |
| [General-purpose task runner](./records/general-purpose-task-runner.md) | proposal | in-progress | Task runner design and routing |
| [Command policy](./command-policy.md) | decision | in-progress | Workspace command and file-tool authorization |

Record types are `issue` (known defect or limitation), `proposal` (suggested improvement), `decision` (chosen direction or constraint), and `fix` (completed corrective change retained for reference). Status values are `planned`, `deferred`, `in-progress`, and `done`. Ordinary implementation details belong in code, tests, or release notes.
