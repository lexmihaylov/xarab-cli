# Xarab

![Xarab](assets/xarab.png)

**A terminal coding agent with a deliberate answer to “which model should handle this?”**

Ask a quick question, investigate a tricky bug, or plan a complex change: Xarab classifies the capability each request calls for and routes it—with relevant conversation context—to the worker you assigned to that tier. You choose the models and providers. The goal is to make model choice inspectable and adaptable, instead of sending every task down the same path.

### Why Xarab?

- **Match the worker to the work.** Route straightforward requests differently from tasks that need deeper investigation or specialized reasoning.
- **Build your own model lineup.** Configure remote models independently for the classifier and each tier, or run a single local or remote model.
- **Get work done in your project.** Workers can inspect and edit files, search code, run commands, and use optional web research tools.
- **Pick up where you left off.** Sessions autosave, can be browsed and restored, and can be compacted to carry important context forward.
- **Inspect and tune routing.** See the chosen tier and rationale, then evaluate a local classifier against labeled examples.

## Try it

**Requirements:** Node.js 26.4.0 or newer. Xarab's terminal UI is built with [OpenTUI](https://github.com/anomalyco/opentui) (`@opentui/core` and `@opentui/react`). Local GGUF inference in `xarab-one` requires a machine supported by [`node-llama-cpp`](https://github.com/withcatai/node-llama-cpp).

```sh
npm install
npm start       # xarab: tier routing
npm run start:one # xarab-one: one model
```

In `xarab`, use `/route` to configure a remote classifier and tier workers. In `xarab-one`, use `/model` to select one model and `/download` to browse local GGUF models. Both share session history, but only one process can open a given session at a time. You can run multiple `xarab` instances and one `xarab-one` instance concurrently.

**First run:** open `/connect` to connect OpenAI or add an OpenRouter API key, then open `/route` to choose a classifier and assign workers to tiers. To run locally without connecting a provider, start `xarab-one` and choose a GGUF model in `/model`. Send a request to see the selected tier and its rationale. Type `/help` for the command list.

## The three-tier system

Tiers describe **the capability needed to do the work well**—not a fixed model size, task length, or number of files. Xarab classifies each new request using the request and a limited amount of recent conversation context, then sends it to that tier's configured worker.

| Tier                | Best fit                                                                                                                          | Examples                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **1 — Focused**     | Clear, bounded work with established patterns                                                                                     | Explain a concept; make a small, straightforward change                                          |
| **2 — Advanced**    | Bounded work that needs investigation, debugging, or architectural judgment                                                       | Trace a bug across related modules; implement a feature after understanding existing conventions |
| **3 — Specialized** | Work where quality depends on unusually deep reasoning, specialized expertise, or careful handling of high-consequence trade-offs | Difficult graphics/performance work; complex security or distributed-systems design              |

**Why tiers?** A small, well-scoped request and a difficult investigation may not need the same worker. Assign models by capability level, then inspect the classifier's choice. If a worker discovers that the remaining work needs materially different capability, it can request a tier adjustment; the router checks the request and only hands off when an appropriate worker is configured. Tiering is a strategy, not a guarantee of lower cost, faster answers, or better results. Outcomes depend on the classifier, assignments, and task.

### Configure your lineup

In **`/route`**, choose a classifier, select Tier 1, 2, or 3, then assign a worker model. The classifier and each worker are independent assignments: mix providers or use one provider throughout. In the routing dialog, Tab or Left/Right switches sections, Up/Down selects, and Enter applies or assigns.

- **OpenAI:** Sign in through `/connect`.
- **OpenRouter:** Add an API key through `/connect`.
- **Local GGUF (`xarab-one` only):** Choose a model in `/model` or find one with `/download`. To delete a downloaded model, highlight it in `/model`, press Ctrl+D, and confirm. Deleting the selected idle model clears the selection.

Models are stored in `~/.xarab/models` by default; set `XARAB_MODELS_DIR` to use another directory. Xarab keeps its configuration, credentials, and sessions under `~/.xarab/`.

## A few useful commands

- `/route` — configure the classifier and tier workers
- `/connect` — connect or manage providers
- `/model` — select the model in `xarab-one`
- `/download [query]` — search Hugging Face for local models (`xarab-one` only)
- `/sessions` — browse saved conversations; `Ctrl+O` also opens the session browser
- `/new [name]`, `/save [name]` — start or save a session
- `/compact` — summarize older conversation to make room for continued work
- `/clear` — start a fresh conversation
- `!<command>` — run a shell command and attach its output to your next message
- `Esc` — stop generation

Follow-up messages sent while Xarab is responding are queued in FIFO order and run after the current turn. Press `Ctrl+X` to remove the newest queued message. The queue is in memory, so queued messages remain pending if a turn is interrupted.

Workers can use project `AGENTS.md` instructions and discover reusable skills from `.agents/skills` in the project or home directory. Available tools include file reading, listing and searching, focused edits, writing files, shell commands, and web search/fetch. Web search requires a Tavily API key: set `TAVILY_API_KEY` in the environment, or add a `tavily` key under `apiKeys` in `~/.xarab/config.json`. The environment variable takes precedence when set.
Xarab also supports local and remote MCP tools with global and workspace configuration. See [MCP server setup and approval](docs/mcp.md).

## Isolated tasks and automatic titles

The main worker can delegate work through the `task` tool. In `xarab`, each task is classified independently. In `xarab-one`, a remote subagent uses the main model; local models do not expose the native `task` tool. Every task runs with a clean conversation context, the supplied brief and selected context, and a built-in `general-purpose` or project agent profile. Tasks can use existing tools but cannot delegate further. MCP servers must be explicitly selected and remain subject to existing consent rules. Progress appears in the task card; the completion summary returns to the main worker. Stopping the parent turn cancels its task, but does not undo edits or other effects already performed.

One agentic task may run per session at a time. Local main-worker and background utility requests share a llama.cpp runtime. These limits do not provide file isolation or a sandbox.

Session titles are generated automatically from at most the first 4,096 characters of the first user message, with the existing first-message title as fallback. Both classification and title generation may use configured remote providers and consume usage. Manual titles are preserved. To disable automatic generation, set `"automaticTitles": false` in `~/.xarab/config.json` before starting Xarab.
After a successful response, Xarab may generate a suggested next message from up to the last 4,096 characters of the response. Press Tab in an empty composer to insert it; edit it before sending if desired. This tool-free utility uses the tier 1 worker in `xarab` or the selected model in `xarab-one`, which may send the excerpt to a remote provider and consume usage. Set `"automaticSuggestions": false` in `~/.xarab/config.json` to disable it.


Project profiles use `.agents/agents/<name>.md`; this is a Xarab format, not a cross-tool standard. Malformed or oversized profiles are reported and skipped without blocking valid profiles or the built-in agent. Directory-level discovery errors still prevent task invocation. Profiles are rediscovered on invocation. See the [task agent guide](docs/task-agents.md) for the profile format and usage.

## Develop and evaluate

```sh
npm test
npm run format:check
```

To evaluate a local GGUF classifier against the labeled starter set:

```sh
npm run classifier:evaluate -- /path/to/classifier.gguf
```

The report includes exact tier accuracy, under- and over-routing, two-tier under-routes, rationales, and average classification time. The examples live in `test/fixtures/classifier-cases.json`, making it possible to refine the rubric and measure how a classifier handles your cases. This evaluation does not call a worker provider.

## Contributing

Xarab is being developed as a configurable coding-agent harness: it routes work to models by the capability it needs, while keeping that decision visible and testable. Contributions help improve its routing, tools, provider integrations, usability, and documentation—and make it easier for more people to try and shape the project. Whether you use Xarab every day, are curious about agent routing, or have spotted something confusing, your perspective is valuable.

Useful contributions include:

- Reporting bugs and sharing clear steps to reproduce them.
- Improving routing, tier guidance, classifier evaluation cases, or evaluation tools.
- Adding or refining provider integrations and workspace tools.
- Making the terminal experience easier to understand and use.
- Improving documentation, examples, and setup instructions.

Not sure whether an idea fits? Open an issue to describe the problem or proposal and discuss a larger change before investing time in it. Pull requests are welcome; please explain what problem the change solves and why you chose this approach. Keep changes focused, and include or update tests when appropriate. Before submitting code changes, run:

```sh
npm test
npm run format:check
```

If a check cannot be run, mention that in the pull request. Thoughtful questions, feedback, and small improvements are just as welcome as major features.

For a focused routing test run:

```sh
node --test test/routing.test.js
```
