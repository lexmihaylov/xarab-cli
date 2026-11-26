export function createSingleTaskPolicy({ getSingleModel }) {
  return {
    async resolveTier({ mode }) {
      if (mode === "agentic" && getSingleModel()?.provider === "local")
        throw new Error("Agentic tasks are unavailable with a local worker model.");
      return undefined;
    },
    assertConfigured({ worker, tier }) {
      if (!worker.getTierInfo(tier).configured) throw new Error("Choose a worker model first.");
    },
  };
}
