import { randomUUID } from "node:crypto";
import { getLlama, LlamaChatSession } from "node-llama-cpp";

export function createLocalLlamaWorkerAdapter({
  modelRuntime = { getLlama, createSession: (options) => new LlamaChatSession(options) },
  contextSize = 16384,
  getContextSize = () => undefined,
  maxTokens = 4096,
} = {}) {
  let model;
  const contexts = {};
  const active = {};
  const lifetime = new AbortController();
  let disposal;

  async function loadContext(modelPath, lane, signal, size) {
    const options = { contextSize: size, flashAttention: true, createSignal: signal };
    if (model?.modelPath === modelPath) {
      if (contexts[lane] && contexts[lane].size !== size) {
        const previous = contexts[lane];
        delete contexts[lane];
        await previous.value.dispose?.();
        signal.throwIfAborted();
      }
      contexts[lane] ??= { value: await model.value.createContext(options), size };
      return contexts[lane].value;
    }
    await disposeResources();
    signal.throwIfAborted();
    const llama = await modelRuntime.getLlama({ logLevel: "warn" });
    signal.throwIfAborted();
    const loadedModel = await llama.loadModel({ modelPath, loadSignal: signal });
    try {
      signal.throwIfAborted();
      contexts[lane] = { value: await loadedModel.createContext(options), size };
    } catch (error) {
      await Promise.resolve()
        .then(() => loadedModel.dispose?.())
        .catch(() => {});
      throw error;
    }
    model = { modelPath, value: loadedModel };
    return contexts[lane].value;
  }

  async function disposeResources() {
    const { primary, validation } = contexts;
    const currentModel = model?.value;
    delete contexts.primary;
    delete contexts.validation;
    model = undefined;
    try {
      try {
        await validation?.value.dispose?.();
      } finally {
        await primary?.value.dispose?.();
      }
    } finally {
      await currentModel?.dispose?.();
    }
  }

  async function start(request, lane) {
    if (lifetime.signal.aborted) throw new Error("Local worker has been disposed.");
    request.signal?.throwIfAborted();
    if (!request.model) throw new Error("A local worker model path is required.");
    const configuredSize = getContextSize(request.model);
    const size =
      Number.isSafeInteger(configuredSize) && configuredSize > 0 ? configuredSize : contextSize;
    if (active[lane] || (lane === "primary" && active.validation))
      throw new Error("Local worker is busy.");
    if (lane === "validation") {
      if (Object.keys(request.tools ?? {}).length)
        throw new Error("Local command validation cannot use tools.");
      // An active worker may be suspended inside a shell tool. Never wait for it,
      // reload its weights, or fall back to its sequence from the validation lane.
      if (
        active.primary &&
        (active.primary.modelPath !== request.model ||
          model?.modelPath !== request.model ||
          active.primary.size !== size)
      )
        throw new Error("The requested local model is not ready for command validation.");
    }
    const signal = request.signal
      ? AbortSignal.any([request.signal, lifetime.signal])
      : lifetime.signal;
    const done = Promise.resolve().then(() => generate({ ...request, signal }, lane, size));
    active[lane] = { modelPath: request.model, size, done };
    try {
      return await done;
    } finally {
      delete active[lane];
    }
  }

  async function generate(
    {
      model: modelPath,
      instructions,
      input,
      tools = {},
      signal,
      onText = () => {},
      onEvent = () => {},
    },
    lane,
    size,
  ) {
    signal.throwIfAborted();
    const context = await loadContext(modelPath, lane, signal, size);
    signal.throwIfAborted();

    const functions = Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [
        name,
        {
          description: tool.description,
          params: tool.params ?? { type: "object", properties: {} },
          async handler(params) {
            signal.throwIfAborted();
            const callId = `local_${randomUUID()}`;
            onEvent({ type: "tool_call", name, callId, arguments: params });
            let result;
            try {
              result = normalizeToolResult(await tool.handler(params, { callId, signal }));
            } catch (error) {
              result = { ok: false, output: `Error: ${error?.message ?? String(error)}` };
            }
            if (result.handoff) throw new TierAdjustmentHandoff(result.handoff);
            return result.output;
          },
        },
      ]),
    );
    const contextSequence = context.getSequence();
    let session;
    try {
      await contextSequence.clearHistory();
      signal.throwIfAborted();
      session = modelRuntime.createSession({
        contextSequence,
        systemPrompt: instructions,
        contextShift: { size: Math.min(6144, Math.floor(size / 2)) },
      });
      const { history, prompt } = formatInput(input);
      if (history.length) session.setChatHistory([...session.getChatHistory(), ...history]);
      try {
        const result = await session.prompt(prompt, {
          functions,
          maxParallelFunctionCalls: 1,
          maxTokens,
          signal,
          onTextChunk: (text) => {
            if (!signal.aborted) onText(text);
          },
        });
        signal.throwIfAborted();
        if (typeof result === "string") return {};
        return result ?? {};
      } catch (error) {
        if (error instanceof TierAdjustmentHandoff) return { handoff: error.handoff };
        throw error;
      }
    } finally {
      try {
        await session?.dispose?.();
      } finally {
        await contextSequence.dispose?.();
      }
    }
  }

  return {
    run: (request) => start(request, "primary"),
    runValidation: (request) => start(request, "validation"),
    dispose() {
      if (disposal) return disposal;
      disposal = (async () => {
        await Promise.allSettled(Object.values(active).map(({ done }) => done));
        await disposeResources();
      })();
      lifetime.abort();
      return disposal;
    },
  };
}

class TierAdjustmentHandoff extends Error {
  constructor(handoff) {
    super("Tier adjustment approved.");
    this.handoff = handoff;
  }
}

function formatInput(input) {
  if (!Array.isArray(input)) return { history: [], prompt: String(input ?? "") };
  const messages = [...input];
  const last = messages.at(-1);
  const prompt = last?.role === "user" ? String(messages.pop().content ?? "") : "";
  const history = [];
  const appendModel = (item) => {
    const last = history.at(-1);
    if (last?.type === "model") last.response.push(item);
    else history.push({ type: "model", response: [item] });
  };
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.type === "tool_call" || message?.type === "tool_result") {
      // Pair only within a contiguous tool exchange, and reject ambiguous IDs.
      const block = [];
      while (i < messages.length && ["tool_call", "tool_result"].includes(messages[i]?.type)) {
        block.push(messages[i++]);
      }
      i -= 1;
      const calls = new Map();
      const results = new Map();
      for (const item of block) {
        const map = item.type === "tool_call" ? calls : results;
        if (item.callId) map.set(item.callId, [...(map.get(item.callId) ?? []), item]);
      }
      for (const item of block) {
        if (item.type !== "tool_call" || !item.callId || !item.name) continue;
        const matchingCalls = calls.get(item.callId);
        const matchingResults = results.get(item.callId);
        if (matchingCalls?.length !== 1 || matchingResults?.length !== 1) continue;
        const result = matchingResults[0];
        if (block.indexOf(result) < block.indexOf(item) || typeof result.ok !== "boolean") continue;
        appendModel({
          type: "functionCall",
          name: item.name,
          params: item.arguments ?? {},
          result: result.ok ? String(result.output ?? "") : `Error: ${String(result.output ?? "")}`,
        });
      }
    } else if (message?.role === "user" || message?.role === "assistant") {
      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      if (message.role === "user") history.push({ type: "user", text: content ?? "" });
      else appendModel(content ?? "");
    }
  }
  return { history, prompt };
}

function normalizeToolResult(result) {
  if (result && typeof result === "object" && typeof result.ok === "boolean")
    return { ...result, output: String(result.output ?? "") };
  return { ok: true, output: typeof result === "string" ? result : JSON.stringify(result) };
}
