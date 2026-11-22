export function createTieredTaskPolicy({ classify }) {
  return {
    async resolveTier({ mode, brief, signal, onClassifying, check }) {
      if (mode === "utility") return 1;
      onClassifying();
      const classification = await classify({
        prompt: brief.slice(0, 4096),
        recentMessages: [],
        signal,
      });
      check();
      if (!classification?.valid || ![1, 2, 3].includes(classification.tier))
        throw new Error(classification?.error || "Task classification failed.");
      return classification.tier;
    },
    assertConfigured({ worker, tier }) {
      if (!worker.getTierInfo(tier).configured)
        throw new Error(`Task worker tier ${tier} is not configured.`);
    },
  };
}
