import { createTierAdjustmentTool } from "../agent/worker/tools/tier-adjustment-tool.js";

export function createTieredWorkerPolicy({ configStore }) {
  function getAssignment(tier) {
    if (tier == null) {
      const model = configStore.getOpenAIModel();
      return model ? { provider: "openai", model } : undefined;
    }
    return configStore.getTierWorker(tier);
  }

  return {
    getAssignment,
    assignmentError: (tier) =>
      tier == null
        ? "Choose an OpenAI model first."
        : `Tier ${tier} is not configured; choose a worker model in /route.`,
    assignmentEvent: (tier, assignment) => ({ tier, ...assignment }),
    prepareTierAdjustment(tier, onTierAdjustment, validateAssignment) {
      const current = getAssignment(tier);
      const hasAlternative = [1, 2, 3].some((candidate) => {
        const alternative = getAssignment(candidate);
        return (
          candidate !== tier &&
          validateAssignment(alternative) &&
          (alternative.provider !== current?.provider ||
            alternative.model !== current?.model ||
            alternative.effort !== current?.effort)
        );
      });
      return (
        [1, 2, 3].includes(tier) &&
        typeof onTierAdjustment === "function" &&
        hasAlternative &&
        createTierAdjustmentTool({ activeTier: tier, requestAdjustment: onTierAdjustment })
      );
    },
    suppressTaskTools: () => false,
  };
}
