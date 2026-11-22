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

  return { setSingleModel };
}
