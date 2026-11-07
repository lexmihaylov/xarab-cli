# Troubleshooting setup, providers, and models

Start with the error shown in Xarab and check the corresponding section below. `/help` lists commands. Configuration and credentials are stored under `~/.xarab`; the [configuration reference](configuration.md) describes the files and settings. Do not share API keys, sign-in URLs, redirect URLs, tokens, or unredacted configuration when asking for help.

## Installation and first run

- Check `node --version`: Xarab requires Node.js 26.4.0 or newer. From the project directory, install dependencies with `npm install` and start with `npm start`. Local GGUF inference also requires a machine supported by `node-llama-cpp`; see the [setup instructions](../README.md#try-it).
- Installation does not download or choose a classifier. Open `/route` and assign a classifier and a worker for each tier you want to use. Connecting a provider alone does not assign its models. The default tier entries name OpenAI but have no worker model.
- If a request reports that a tier is not configured or has no worker model selected, open `/route` and assign a model to that tier. Classifier and tier assignments are independent.

## Provider connection and model discovery

- **OpenAI:** In `/connect`, start ChatGPT sign-in, open the authorization URL, then paste the **full localhost redirect URL** into Xarab. If clipboard copying fails, use the displayed URL. A sign-in error is shown in the connection dialog. OpenAI uses ChatGPT sign-in, not `apiKeys.openai`.
- **OpenRouter:** Add the API key in `/connect`. “API key saved” confirms local storage, not model access. Refresh `/route` to check discovery. A missing key yields no OpenRouter models; discovery errors include the HTTP status. Check the saved key and the reported error without exposing the key.
- `/route` loads provider model lists separately and displays discovery errors; one provider's failure need not prevent the other provider's models from appearing. OpenRouter discovery shows models advertising text output. OpenAI discovery also adds a built-in list of known model IDs, so presence in the list is not proof that your account can use a model.
- For a provider request failure, note the provider, model ID, status and error code if shown. OpenAI model-list errors may include a request ID. Remove secrets and sensitive content before sharing diagnostics.

## Local models

- Use `/download [query]` to search for GGUF models, then choose the classifier or worker in `/route`. The chooser lists `.gguf` files directly in the configured model directory, `~/.xarab/models` by default. `XARAB_MODELS_DIR` overrides it; a relative value is resolved from the working directory.
- If a model is missing from the chooser, check its directory and `.gguf` filename. If an assigned local model fails to load, check that its configured path still exists and that the machine supports local inference. A local classifier and a local worker are separate assignments.

## Configuration, stalled responses, and other tools

- If manually edited configuration fails to load, check JSON syntax and file paths; malformed JSON is not treated as a missing file. Preserve existing fields and restart Xarab after editing global settings. See the [configuration reference](configuration.md) for routing and defaults.
- If an OpenAI response remains generating without progress, `Esc` stops generation. Automatic timeout and retry recovery is a [deferred issue](records/openai-response-timeout-recovery.md), not a current guarantee. Before repeating a request, inspect what already happened: stopping generation does not undo changes or other effects.
- For web search, configure `TAVILY_API_KEY` or `apiKeys.tavily`; a nonempty environment value takes precedence. Web search also requires approval. For MCP configuration, connection, authentication and approval details, see the [MCP guide](mcp.md).
