export function createSingleChooserActions({
  configStore,
  getModelModal,
  setModelModal,
  isBusy,
  updateStatus,
  notify,
}) {
  async function setSingleModel(assignment) {
    try {
      if (isBusy()) throw new Error("Wait for the current work to finish before changing models.");
      await configStore.setSingleModel(assignment);
      if (getModelModal()?.mode === "chooser") setModelModal(null);
      updateStatus("Ready");
    } catch (error) {
      if (getModelModal()?.mode === "chooser")
        setModelModal({ ...getModelModal(), error: error.message });
      notify();
    }
  }

  async function setModelContextSize(modelPath, value) {
    try {
      if (isBusy())
        throw new Error("Wait for the current work to finish before changing context size.");
      await configStore.setModelContextSize(modelPath, value);
      const modal = getModelModal();
      if (modal?.mode === "chooser") {
        const settings = { ...modal.modelSettings?.[modelPath] };
        if (value === undefined) delete settings.contextSize;
        else settings.contextSize = value;
        setModelModal({
          ...modal,
          modelSettings: { ...modal.modelSettings, [modelPath]: settings },
          error: null,
        });
      }
      notify();
      return true;
    } catch (error) {
      const modal = getModelModal();
      if (modal?.mode === "chooser") setModelModal({ ...modal, error: error.message });
      notify();
      return false;
    }
  }

  return { setSingleModel, setModelContextSize };
}
