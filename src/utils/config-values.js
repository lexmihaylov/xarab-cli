import path from "node:path";

export const PROVIDERS = ["openai", "local", "openrouter"];
export function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAssignment(value, { requireModel = true, keepEffort = true } = {}) {
  if (!isRecord(value) || !PROVIDERS.includes(value.provider)) return null;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!model && (requireModel || value.provider === "local")) return null;
  const effort = typeof value.effort === "string" ? value.effort.trim() : "";
  return {
    provider: value.provider,
    ...(model && { model: value.provider === "local" ? path.resolve(model) : model }),
    ...(keepEffort && value.provider !== "local" && effort && { effort }),
    ...(keepEffort &&
    value.provider !== "local" &&
    Number.isSafeInteger(value.contextWindow) &&
    value.contextWindow > 0
      ? { contextWindow: value.contextWindow }
      : {}),
  };
}
