import { createTieredConfigStore } from "./config-store.js";
import { createTieredChooserActions } from "./chooser-actions.js";
import { createTieredRouting } from "./routing.js";
import { createTieredTaskPolicy } from "./task-policy.js";
import { createTieredWorkerPolicy } from "./worker-policy.js";
import * as commands from "./command-handler.js";

const setup = "Use /route to configure the classifier and tier workers";

export function createTieredAppPolicy() {
  return {
    remoteOnly: true,
    chooserCommand: "/route",
    createConfigStore: createTieredConfigStore,
    createWorkerPolicy: (configStore) => createTieredWorkerPolicy({ configStore }),
    createRouting: createTieredRouting,
    createTaskPolicy: (_, routing) =>
      createTieredTaskPolicy({ classify: (request) => routing.getClassifier().classify(request) }),
    createChooserActions: createTieredChooserActions,
    commands,
    modelState: (config) => ({ classifier: config.getClassifier(), singleModel: undefined }),
    initialStatus: () => setup,
    sessionStatus: (config, status) =>
      status === "Ready" && !config.getClassifier() ? setup : status,
    tracksUsage: (config, tier) =>
      config.getTierWorker(tier)?.provider === "openai" ||
      (tier == null && Boolean(config.getOpenAIModel())),
    compactionMessage: (classification) =>
      `Tier ${classification.tier} has no valid worker model; choose a remote model in /route.`,
    async chooserState(config, modelManager) {
      const models = [];
      return {
        models,
        modelSettings: modelManager.getModelSettings(models),
        classifier: config.getClassifier(),
        tierWorkers: config.get().tierWorkers,
        defaultOpenAIModel: config.getOpenAIModel(),
      };
    },
  };
}

export const tieredAppPolicy = createTieredAppPolicy();
