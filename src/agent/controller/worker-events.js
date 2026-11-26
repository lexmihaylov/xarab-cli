import { addTokenUsage } from "../token-usage.js";

export function createWorkerEvents({
  assistantMessage,
  getMessages,
  tracksUsage,
  getActiveSession,
  sessionChanged,
  notify,
  updateStatus,
  getStatus,
}) {
  let contextWindow;
  let contextUsage;
  const usageResponses = new Set();
  let previewItems = new Map();
  let pendingItems = new Map();

  const previewFor = (itemId, outputIndex) => {
    const entries = [...previewItems.values()];
    return (
      (itemId && entries.find((entry) => entry.itemId === itemId)) ||
      entries.find(
        (entry) =>
          outputIndex != null &&
          entry.outputIndex === outputIndex &&
          (!itemId || !entry.itemId || entry.itemId === itemId),
      )
    );
  };

  const bindPreview = (item, outputIndex) => {
    if (item?.type !== "function_call") {
      return;
    }

    const entry = previewFor(item.id, outputIndex);
    if (entry && typeof item.call_id === "string" && item.call_id) {
      entry.part.callId = item.call_id;
    }
  };

  const settlePreviews = () => {
    for (const part of assistantMessage.parts) {
      if (part.preview && part.status === "running") {
        part.status = "error";
        part.title = "Tool call not executed";
      }
    }
    previewItems = new Map();
    pendingItems = new Map();
  };

  if (tracksUsage) {
    assistantMessage.workerUsageUnavailable = true;
  }
  return {
    onAssignment: (assignment) => {
      if (assignment.provider !== "local") {
        contextWindow =
          Number.isSafeInteger(assignment.contextWindow) && assignment.contextWindow > 0
            ? assignment.contextWindow
            : 80_000;
      }
    },
    onEvent(event) {
      if (
        event.type === "local_context_usage" &&
        Number.isSafeInteger(event.contextSize) &&
        event.contextSize > 0 &&
        Number.isSafeInteger(event.occupiedTokens) &&
        event.occupiedTokens >= 0
      ) {
        contextWindow = event.contextSize;
        contextUsage = event.occupiedTokens;
      }

      const usage =
        event.type === "context_usage"
          ? { input: event.inputTokens, output: event.outputTokens }
          : ["response.completed", "response.done"].includes(event.type)
            ? {
                input: event.response?.usage?.input_tokens,
                output: event.response?.usage?.output_tokens,
              }
            : undefined;
      if (Number.isSafeInteger(usage?.input) && usage.input >= 0) {
        contextUsage =
          usage.input +
          (Number.isSafeInteger(usage.output) && usage.output >= 0 ? usage.output : 0);
      }

      if (event.type === "openrouter_history") {
        assistantMessage.openrouterMessages = event.messages;
        assistantMessage.openrouterTextLength = assistantMessage.parts
          .filter((part) => part.type === "text")
          .reduce((length, part) => length + (part.text?.length ?? 0), 0);
        sessionChanged();
        return;
      }

      if (event.type === "provider_retry") {
        settlePreviews();
        sessionChanged();
        notify();
        updateStatus(
          `${event.provider} response ${event.reason === "empty_response" ? "was empty" : "stalled"}; retrying (${event.attempt}/${event.maxRetries})…`,
        );
        return;
      }

      if (/response (?:stalled|was empty); retrying/.test(getStatus())) {
        updateStatus("Worker generating…");
      }

      if (event.type === "tool_call_started" || event.type === "tool_call_delta") {
        let entry = previewFor(event.itemId, event.outputIndex);
        if (!entry && (event.itemId || event.outputIndex != null)) {
          const name = typeof event.name === "string" ? event.name.slice(0, 100) : "tool";
          const part = {
            type: "tool",
            id: Symbol(name),
            toolName: name,
            params: {},
            label: `Preparing ${name}`,
            title: `Preparing ${name}`,
            status: "running",
            preview: true,
            previewArguments: "",
          };
          entry = { itemId: event.itemId, outputIndex: event.outputIndex, part };
          previewItems.set(part.id, entry);
          if (!getMessages().includes(assistantMessage)) {
            getMessages().push(assistantMessage);
          }
          assistantMessage.parts.push(part);
          bindPreview(pendingItems.get(event.outputIndex), event.outputIndex);
        }
        if (entry) {
          if (event.itemId) {
            entry.itemId = event.itemId;
          }

          if (event.outputIndex != null) {
            entry.outputIndex = event.outputIndex;
          }
          if (typeof event.name === "string" && event.name) {
            entry.part.toolName = event.name.slice(0, 100);
            entry.part.label = `Preparing ${entry.part.toolName}`;
            entry.part.title = entry.part.label;
          }
          if (typeof event.delta === "string") {
            entry.part.previewArguments = (entry.part.previewArguments + event.delta).slice(
              0,
              4096,
            );
            entry.part.summary = entry.part.previewArguments;
          }
          sessionChanged();
          notify();
        }
        return;
      }

      if (
        event.type === "response.output_item.added" ||
        event.type === "response.output_item.done"
      ) {
        if (event.item?.type === "function_call") {
          pendingItems.set(event.output_index, event.item);
        }
        bindPreview(event.item, event.output_index);
      }

      if (["response.completed", "response.done"].includes(event.type)) {
        event.response?.output?.forEach((item, index) => bindPreview(item, index));
        previewItems = new Map();
        pendingItems = new Map();
      }

      if (!tracksUsage || !["response.completed", "response.done"].includes(event.type)) {
        return;
      }

      const response = event.response;
      if (!response || (response.id && usageResponses.has(response.id))) {
        return;
      }

      if (response.id) {
        usageResponses.add(response.id);
      }
      const session = getActiveSession();
      session.contextTokens =
        Number.isSafeInteger(response.usage?.input_tokens) && response.usage.input_tokens >= 0
          ? response.usage.input_tokens
          : null;
      sessionChanged();
      notify();
      const next = addTokenUsage(assistantMessage.workerUsage, response.usage);
      if (next === assistantMessage.workerUsage) {
        assistantMessage.workerUsagePartial = true;
        return;
      }

      assistantMessage.workerUsage = next;
      assistantMessage.workerUsageUnavailable = false;
      session.workerUsage = addTokenUsage(session.workerUsage, response.usage);
      sessionChanged();
      notify();
    },
    settlePreviews,
    getContext: () => ({ contextWindow, contextUsage }),
  };
}
