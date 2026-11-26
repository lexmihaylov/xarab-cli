import { createOpenAIModelManager } from "../openai-model-manager.js";
import { createOpenRouterModelManager } from "../openrouter-model-manager.js";

export function createRemoteModelDiscovery({
  getCredentials,
  getOpenRouterApiKey,
  getModelModal,
  getChooserIdentity,
  setModelModal,
  notify,
}) {
  const openAIModelManager = createOpenAIModelManager({ getCredentials });
  const openRouterModelManager = createOpenRouterModelManager({ getApiKey: getOpenRouterApiKey });
  let latestRequest = 0;

  return async function loadRouterWorkerModels() {
    const initialModal = getModelModal();
    if (initialModal?.mode !== "chooser") {
      return;
    }

    const chooserIdentity = getChooserIdentity();
    const request = ++latestRequest;
    setModelModal({ ...initialModal, loadingProviderModels: true, providerModelError: null });
    notify();

    const results = await Promise.allSettled([
      openAIModelManager.listModels(),
      openRouterModelManager.listModels(),
    ]);

    const currentModal = getModelModal();
    if (
      currentModal?.mode !== "chooser" ||
      getChooserIdentity() !== chooserIdentity ||
      request !== latestRequest
    ) {
      return;
    }

    const models = [
      ...currentModal.models.filter((model) => model.provider === "local"),
      ...results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    ];
    const errors = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `${index === 0 ? "OpenAI" : "OpenRouter"}: ${result.reason?.message ?? "Model discovery failed"}`,
          ]
        : [],
    );
    setModelModal({
      ...currentModal,
      models,
      loadingProviderModels: false,
      providerModelError: errors.join(" · ") || null,
    });
    notify();
  };
}
