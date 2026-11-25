// Only offer efforts advertised by discovery; never infer support from a model ID.
export function workerVariants(model) {
  const base = {
    provider: model.provider,
    model: model.id,
    ...(model.provider !== "local" &&
    Number.isSafeInteger(model.contextWindow) &&
    model.contextWindow > 0
      ? { contextWindow: model.contextWindow }
      : {}),
  };
  if (model.provider === "local") return [base];
  const advertised =
    model.provider === "openai"
      ? model.supported_reasoning_levels?.map((level) => level.effort)
      : model.reasoning?.supported_efforts;
  // OpenRouter documents null as accepting all gateway efforts; absent means no selector.
  const efforts =
    advertised === null
      ? ["max", "xhigh", "high", "medium", "low", "minimal", "none"]
      : Array.isArray(advertised)
        ? advertised
        : [];
  return [
    { ...base, effort: "default" },
    ...[...new Set(efforts)]
      .filter(
        (effort) =>
          typeof effort === "string" &&
          effort &&
          !(model.reasoning?.mandatory && effort === "none"),
      )
      .map((effort) => ({ ...base, effort })),
  ];
}

export function effortLabel(worker) {
  if (!worker || worker.provider === "local") return "";
  return worker.effort === "default"
    ? "provider default"
    : (worker.effort ?? (worker.provider === "openai" ? "low (legacy)" : "provider default"));
}

export function workerKey(worker) {
  return `${worker.provider}:${worker.model}:${worker.effort ?? "legacy"}`;
}
