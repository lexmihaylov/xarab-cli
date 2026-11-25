# Configuration reference

Xarab's CLI uses JSON configuration under `~/.xarab`. Use `/connect` to manage provider connections and `/route` to assign the classifier and tier workers. Manually edited global settings are loaded at startup; restart Xarab after changing them. Preserve other fields when editing these files. Secrets in configuration are not encrypted at rest; restrict access and do not commit them.

## Files and storage

| Path | Purpose |
| --- | --- |
| `~/.xarab/config.json` | General settings, model metadata, API keys and global MCP servers. |
| `~/.xarab/routing.conf` | JSON routing assignments, despite the `.conf` extension. |
| `~/.xarab/auth/openai-chatgpt.json` | OpenAI ChatGPT sign-in credentials, managed by `/connect`. |
| `~/.xarab/auth/mcp/` | MCP OAuth credentials; see [MCP servers](mcp.md). |
| `~/.xarab/models/` | Default local model directory; overridable with `XARAB_MODELS_DIR`. |
| `~/.xarab/sessions/` | Saved sessions. |
| `~/.xarab/xarab.log` | Diagnostic log. |
| `<workspace>/.xarab/mcp.json` | Workspace MCP server definitions, read for each worker run. |

Config writes create parent directories and use a temporary file and rename; newly written files use mode `0600`. Missing configuration files use defaults; malformed JSON is not treated as a missing file. When `routing.conf` is absent and legacy routing fields exist in `config.json`, `xarab` migrates them to the routing file and removes them from the general file. `xarab-one` reads and writes `config.json` without opening `routing.conf` or migrating routing settings. Both commands coordinate writes to `config.json` so one does not overwrite unrelated settings saved by the other. A legacy `classifierModel` string is interpreted as a local classifier path.

## General settings

The following are fields of `~/.xarab/config.json`:

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | `{}` | Local model metadata keyed by absolute model path. Recognized fields are `name`, `contextSize`, and `inputBudget`. For `xarab-one`, `contextSize` is a positive safe integer in tokens; absent or invalid values use 16384. Change it per local model through `/model`, or reset it to the default. Larger contexts require more memory. Use Ctrl+B in `/model` to set or reset the local input budget (default: 85% of context size; overrides are capped below context size). Other metadata fields are ignored on load. |
| `apiKeys` | `{}` | Provider keys, including `openrouter` for OpenRouter and `tavily` for web search. `/connect` manages the OpenRouter key. |
| `openaiModel` | `null` | OpenAI model ID used for worker requests without a tier; it does not replace tier assignments. |
| `automaticTitles` | enabled | Set to `false` to disable automatic session titles. Other values do not disable it. |
| `automaticSuggestions` | enabled | Set to `false` to disable suggested next messages. Other values do not disable it. |
| `mcp` | no servers | Global MCP server map. See [MCP servers](mcp.md) for fields, validation, precedence, authentication and approval. |

Automatic titles and suggestions may send excerpts to configured remote providers and consume usage. An example that disables them and configures web search (replace the placeholder, and keep the file private):

```json
{
  "automaticTitles": false,
  "automaticSuggestions": false,
  "apiKeys": { "tavily": "YOUR_TAVILY_KEY" }
}
```

OpenAI uses ChatGPT sign-in rather than the `apiKeys.openai` field. OpenRouter reads `apiKeys.openrouter`; Xarab's source does not use an OpenRouter environment variable for this key.

## Routing settings

`~/.xarab/routing.conf` contains `classifier` and `tierWorkers`. The default classifier is `null`; all three tiers default to `{ "provider": "openai" }` **without a model**, so they are not ready to run until assigned. Installation does not choose or download a classifier. Use `/route` to configure these assignments.

```json
{
  "classifier": { "provider": "openrouter", "model": "provider/classifier-id" },
  "tierWorkers": {
    "1": { "provider": "openrouter", "model": "provider/model-id" },
    "2": { "provider": "openai", "model": "your-openai-model-id" },
    "3": { "provider": "openrouter", "model": "provider/worker-id" }
  }
}
```

`xarab` accepts only `openai` and `openrouter` for classifiers and tier workers. Assignments use remote model IDs. Previously saved local assignments are preserved during migration but cannot run; replace them in `/route`. Invalid tier entries fall back to the default for that tier. When a separate routing file exists, its tier map is normalized independently; a missing or invalid classifier there falls back to the classifier loaded from the general file.

## Environment variables

| Variable | Behavior |
| --- | --- |
| `XARAB_MODELS_DIR` | Overrides the local model directory; a relative value is resolved against the working directory. An empty value uses `~/.xarab/models`. |
| `TAVILY_API_KEY` | Web-search key. A nonempty trimmed value takes precedence over `apiKeys.tavily`; otherwise the stored key is used. Web search also requires user approval. |
| `NODE_ENV` | Set to `production` at startup only if not already set. |
| `WSL_DISTRO_NAME`, `WSL_INTEROP` | Either nonempty value selects `clip.exe` for clipboard copying; a Microsoft OS release also triggers WSL detection. |

This table describes environment variables read directly by Xarab's application code, not variables used by Node.js, dependencies, subprocesses or configured MCP servers.

### Worker input budgets

Remote workers reserve 15% of the selected model's advertised context window. If
context metadata is missing (including for an older saved selection), Xarab
assumes an 80,000-token window, giving a 68,000-token input budget. Reselect a
remote model to capture newly discovered metadata. Remote checks conservatively
charge each serialized UTF-8 byte as one estimated token; this can reject
requests that would fit the provider's tokenizer. Local workers use the model's
tokenizer and check the formatted prompt where available. These checks do not
predict all provider-side overhead.

If older history puts the initial request over budget, Xarab makes one tool-free
summary attempt using the selected model. It replaces the older history only if
both summarization and the retried turn succeed. The current prompt is kept
verbatim. An oversized continuation stops with an error instead of replaying
completed tools. The summarizer is subject to its own request budget and does not
chunk the history.
