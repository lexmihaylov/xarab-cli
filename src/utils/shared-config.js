import { isRecord } from "./config-values.js";

export function createSharedConfig(storage) {
  function get() {
    const {
      apiKeys,
      classifier,
      classifierModel,
      tierWorkers,
      models,
      singleModel,
      openaiModel,
      lastModel,
      ...settings
    } = storage.get().general;
    return {
      ...settings,
      apiKeys: isRecord(apiKeys)
        ? Object.fromEntries(
            Object.entries(apiKeys).filter(
              ([provider, key]) => /^[a-z0-9_-]+$/i.test(provider) && typeof key === "string",
            ),
          )
        : {},
    };
  }
  const { updateGeneral } = storage;
  return {
    get,
    getApiKey(provider) {
      return get().apiKeys[provider];
    },
    async setApiKey(provider, apiKey) {
      if (typeof provider !== "string" || !/^[a-z0-9_-]+$/i.test(provider))
        throw new Error("Provider must be a non-empty identifier.");
      if (typeof apiKey !== "string" || !apiKey.trim())
        throw new Error("API key must be a non-empty string.");
      await updateGeneral((general) => {
        general.apiKeys = {
          ...(isRecord(general.apiKeys) ? general.apiKeys : {}),
          [provider]: apiKey.trim(),
        };
      });
    },
    async removeApiKey(provider) {
      await updateGeneral((general) => {
        if (!isRecord(general.apiKeys)) general.apiKeys = {};
        delete general.apiKeys[provider];
      });
    },
  };
}
