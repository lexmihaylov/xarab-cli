# Worker reasoning effort

The `/route` worker chooser lists separate model · effort rows. **Provider default**
is an explicit choice, saved as `effort: "default"`; it omits effort from the request.
Other choices send the advertised effort verbatim. Missing effort in old settings
retains previous behavior: OpenAI `low`, OpenRouter no reasoning override. Local
workers, classifier selection, and image analysis are unchanged.

Efforts are discovered rather than inferred from model names:

- Codex `/models`: `supported_reasoning_levels` (including descriptions) and
  `default_reasoning_level` are retained. Schema evidence:
  https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs
  (`ModelInfo` and `ReasoningEffortPreset`).
- OpenRouter `/api/v1/models`: the `reasoning` metadata object is retained.
  `supported_efforts` omitted means no effort selector; null accepts all gateway
  efforts. Mandatory reasoning excludes `none`. Evidence:
  https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

Both worker request adapters map explicit choices to `reasoning.effort`.
Different efforts on the same model count as distinct tier choices.

OpenRouter streaming `reasoning_details` blocks are kept opaque, in stream order,
with unknown fields and signatures intact. They accompany the assistant tool-call
message on immediate continuations. Completed turn messages (including exact tool
calls/results) are stored as provider-specific session metadata and replayed for
OpenRouter within the existing recent-tool-history window; other providers use
ordinary history. This metadata is not displayed as reasoning text. Existing
sessions without this metadata continue to use legacy history serialization.
Compaction intentionally replaces older conversation context rather than retaining
all signed blocks indefinitely. No live authenticated provider request is needed
for the regression tests.
