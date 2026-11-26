import { createSingleConfigStore } from "./config-store.js";
import { createSingleChooserActions } from "./chooser-actions.js";
import { createSingleTaskPolicy } from "./task-policy.js";
import { createSingleWorkerPolicy } from "./worker-policy.js";
import * as commands from "./command-handler.js";

export const singleAppPolicy = {
  remoteOnly: false,
  canDeleteLocalModels: true,
  chooserCommand: "/model",
  createConfigStore: createSingleConfigStore,
  createWorkerPolicy: ({ getSingleModel }) => createSingleWorkerPolicy({ getSingleModel }),
  createTaskPolicy: ({ getSingleModel }) => createSingleTaskPolicy({ getSingleModel }),
  createRouting: ({ getWorker }) => ({
    classifyForRouting: async () => ({ worker: getWorker().getTierInfo() }),
    mayAdjust: () => false,
  }),
  createChooserActions: createSingleChooserActions,
  commands,
  modelState: (config) => ({ classifier: null, singleModel: config.getSingleModel() }),
  initialStatus: (config) => (config.getSingleModel() ? "Ready" : "Use /model to choose a model"),
  sessionStatus: (_, status) => status,
  tracksUsage: (config) => config.getSingleModel()?.provider === "openai",
  compactionMessage: () => "Choose a model with /model before compacting.",
  routeMessage(config, text, { runWorker, addMessage }) {
    if (config.getSingleModel()) return runWorker(text);
    return addMessage({
      type: "system",
      severity: "warning",
      message: "Choose a model with /model before chatting.",
    });
  },
  async chooserState(_, modelManager) {
    const models = await modelManager.listModels();
    return { models, modelSettings: modelManager.getModelSettings(models) };
  },
};
