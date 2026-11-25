// Deliberately pessimistic: charge each serialized UTF-8 byte as one token.
// This is not a provider tokenizer or a guarantee about hidden framing costs.
export function estimateRequestTokens(request) {
  return Buffer.byteLength(JSON.stringify(request), "utf8");
}

export class ContextBudgetError extends Error {
  constructor(provider, model, estimated, budget, { continuation, detail = "" } = {}) {
    const subject = continuation ? "Tool continuation" : "Request";
    super(
      `${subject} for ${provider} model ${model} exceeds the estimated input budget (${estimated} estimated tokens, ${budget} available${detail}). ${continuation ? "Completed tools were not rerun. Reduce the tool output before continuing." : "Reduce the prompt, conversation history, or tool definitions."}`,
    );
    this.name = "ContextBudgetError";
  }
}
