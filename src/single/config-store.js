import path from "node:path";
import { createConfigStorage } from "../utils/config-storage.js";
import { isRecord, normalizeAssignment } from "../utils/config-values.js";
import { createSharedConfig } from "../utils/shared-config.js";

function normalizeModelMetadata(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([modelPath, settings]) => {
      if (!isRecord(settings)) return [];
      const name = typeof settings.name === "string" ? settings.name.trim() : "";
      const contextSize = settings.contextSize;
      return [
        [
          modelPath,
          {
            ...(name ? { name } : {}),
            ...(Number.isSafeInteger(contextSize) && contextSize > 0 ? { contextSize } : {}),
          },
        ],
      ];
    }),
  );
}

export function singleSettings(storage) {
  const { updateGeneral } = storage;
  const getModels = () => normalizeModelMetadata(storage.get().general.models);
  return {
    getModels,
    getModel(modelPath) {
      return getModels()[path.resolve(modelPath)] ?? {};
    },
    getSingleModel() {
      return normalizeAssignment(storage.get().general.singleModel);
    },
    async setSingleModel(assignment) {
      const model = assignment === null ? null : normalizeAssignment(assignment);
      if (assignment !== null && !model)
        throw new Error(
          "A single model requires an openai, openrouter, or local provider and a model.",
        );
      await updateGeneral((general) => {
        general.singleModel = model;
      });
    },
    async setModelContextSize(modelPath, value) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
        throw new Error("Context size must be a positive safe integer.");
      const modelKey = path.resolve(modelPath);
      await updateGeneral((general) => {
        if (!isRecord(general.models)) general.models = {};
        if (!isRecord(general.models[modelKey])) general.models[modelKey] = {};
        if (value === undefined) delete general.models[modelKey].contextSize;
        else general.models[modelKey].contextSize = value;
      });
    },
    async ensureModel(modelPath) {
      const modelKey = path.resolve(modelPath);
      await updateGeneral((general) => {
        if (!isRecord(general.models)) general.models = {};
        if (isRecord(general.models[modelKey])) return false;
        general.models[modelKey] = {};
      });
    },
    async removeDeletedLocalModel(modelPath) {
      const modelKey = path.resolve(modelPath);
      let clearedSingleModel = false;
      await updateGeneral((general) => {
        const assignment = normalizeAssignment(general.singleModel);
        clearedSingleModel = assignment?.provider === "local" && assignment.model === modelKey;
        if (clearedSingleModel) general.singleModel = null;
        if (!isRecord(general.models) || !Object.hasOwn(general.models, modelKey))
          return clearedSingleModel;
        delete general.models[modelKey];
      });
      return { clearedSingleModel };
    },
    async removeModel(modelPath) {
      const modelKey = path.resolve(modelPath);
      await updateGeneral((general) => {
        if (!isRecord(general.models)) general.models = {};
        delete general.models[modelKey];
      });
    },
  };
}

export function createSingleConfigStore(configPath) {
  const storage = createConfigStorage(configPath);
  const shared = createSharedConfig(storage);
  const settings = singleSettings(storage);
  const get = () => ({
    ...shared.get(),
    singleModel: settings.getSingleModel(),
    models: settings.getModels(),
  });
  return {
    ...shared,
    ...settings,
    get,
    async load() {
      await storage.load();
      return get();
    },
  };
}
