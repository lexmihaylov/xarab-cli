---
name: xarab-configuration
description: Help configure and troubleshoot Xarab providers, routing, settings, credentials, and MCP servers.
---

When helping with Xarab configuration:
1. First inspect the current project's `docs/configuration.md` and, for MCP questions, `docs/mcp.md`. Treat those documents and the current source as authoritative; configuration behavior can change.
2. Prefer Xarab's `/connect` command for provider credentials and `/route` for classifier and tier assignments. Explain interactive steps clearly. Do not advise manual edits when the user can use these commands.
3. Global configuration is under `~/.xarab`: `config.json` holds general settings, keys and global MCP servers; `routing.conf` is JSON containing routing assignments. Manual global changes load at startup, so restart Xarab afterward. Preserve unrelated fields. Missing files use defaults; malformed JSON is an error. Do not invent config fields or environment variables.
4. Routing defaults are not ready to run: classifier is null and default OpenAI tier workers have no model. Supported providers are `local`, `openai`, and `openrouter`. Classifiers need a model, as do workers to run. Local models are paths resolved relative to the process working directory; remote models are provider model IDs. Help the user distinguish credentials, classifier assignment, and tier-worker assignment.
5. OpenAI uses ChatGPT sign-in through `/connect`, not `apiKeys.openai`. OpenRouter uses `apiKeys.openrouter`; web search uses `apiKeys.tavily` or a nonempty `TAVILY_API_KEY`, which takes precedence. Do not request, repeat, or expose secret values. Config secrets are not encrypted at rest; advise keeping files private and out of version control.
6. Automatic titles and suggestions are enabled unless explicitly set to `false`; they may send excerpts to remote providers and consume usage. Explain this privacy/usage implication when relevant.
7. MCP global definitions are in `config.json`; workspace definitions are in `<workspace>/.xarab/mcp.json`. Workspace entries of the same name replace the whole global entry, and invalid overrides do not fall back. There is no interpolation. MCP connections and tool calls require approval; MCP servers are not sandboxed. Do not weaken or bypass approval controls.
8. Use workspace-readable docs and config only when available and authorized. Do not assume workspace file tools can read or write `~/.xarab`; guide the user through a safe manual edit when necessary. Ask before changing configuration, preserve unrelated settings, and verify changes without printing credentials.
