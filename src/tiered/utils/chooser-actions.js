export function createTieredChooserActions({
  configStore,
  getModelModal,
  setModelModal,
  notify,
  routing,
}) {
  const getTierClassifier = routing.getClassifier;
  async function setRouterClassifier(input) {
    const assignment = typeof input === "string" ? { provider: "local", model: input } : input;
    if (assignment && getModelModal())
      setModelModal({ ...getModelModal(), loadingClassifier: true, error: null });
    notify();
    try {
      if (assignment?.provider === "local") throw new Error("Choose a remote classifier in xarab.");
      await configStore.setClassifier(assignment);
      await getTierClassifier().load();
      if (getModelModal())
        setModelModal({
          ...getModelModal(),
          classifier: assignment,
          loadingClassifier: false,
          error: null,
        });
    } catch (error) {
      if (getModelModal())
        setModelModal({
          ...getModelModal(),
          loadingClassifier: false,
          error: `Could not load or save classifier: ${error.message}`,
        });
    }
    notify();
  }

  async function setRouterTierWorker(tier, worker) {
    try {
      if (worker?.provider === "local") throw new Error("Choose a remote worker in xarab.");
      await configStore.setTierWorker(tier, worker);
      if (getModelModal()) {
        setModelModal({
          ...getModelModal(),
          tierWorkers: { ...getModelModal().tierWorkers, [tier]: worker },
          error: null,
        });
      }
    } catch (error) {
      if (getModelModal())
        setModelModal({
          ...getModelModal(),
          error: `Could not save tier worker: ${error.message}`,
        });
    }
    notify();
  }

  return { setRouterClassifier, setRouterTierWorker };
}
