import path from "node:path";
import { createConfigStorage } from "../../utils/config-storage.js";
import { isRecord, normalizeAssignment, PROVIDERS } from "../../utils/config-values.js";
import { createSharedConfig } from "../../utils/shared-config.js";

const DEFAULT_TIER_WORKERS = Object.freeze({
  1: { provider: "openai" },
  2: { provider: "openai" },
  3: { provider: "openai" },
});

function normalizeTierWorkers(value) {
  const workers = structuredClone(DEFAULT_TIER_WORKERS);
  if (!isRecord(value)) return workers;
  for (const tier of [1, 2, 3]) {
    const worker = normalizeAssignment(value[tier], { requireModel: false });
    if (worker) workers[tier] = worker;
  }
  return workers;
}

function normalizeClassifier(value) {
  if (typeof value === "string" && value.trim())
    return { provider: "local", model: path.resolve(value.trim()) };
  return normalizeAssignment(value, { keepEffort: false });
}

const LEGACY_ROUTING_FIELDS = ["classifier", "classifierModel", "tierWorkers"];

export function createRoutingStorage(configPath, routingConfigPath) {
  return createConfigStorage(configPath, routingConfigPath, {
    needed: ({ general, routing }) =>
      !routing && LEGACY_ROUTING_FIELDS.some((key) => Object.hasOwn(general, key)),
    apply(general, routing) {
      routing.classifier = normalizeClassifier(general.classifier ?? general.classifierModel);
      routing.tierWorkers = normalizeTierWorkers(general.tierWorkers);
      for (const key of LEGACY_ROUTING_FIELDS) delete general[key];
    },
  });
}

export function tieredSettings(storage) {
  const { separate, update, updateGeneral } = storage;
  function getRouting() {
    const { general, routing = general } = storage.get();
    return {
      classifier:
        normalizeClassifier(routing.classifier ?? routing.classifierModel) ??
        normalizeClassifier(general.classifier ?? general.classifierModel),
      tierWorkers: normalizeTierWorkers(routing.tierWorkers),
    };
  }
  return {
    getRouting,
    getOpenAIModel() {
      const { openaiModel } = storage.get().general;
      return typeof openaiModel === "string" ? openaiModel : null;
    },
    getClassifier() {
      return getRouting().classifier;
    },
    async setClassifier(assignment) {
      if (assignment?.provider === "local") throw new Error("Choose a remote classifier in xarab.");
      if (assignment !== null) {
        if (!assignment || !PROVIDERS.includes(assignment.provider))
          throw new Error("Classifier provider must be openai or openrouter.");
        if (typeof assignment.model !== "string" || !assignment.model.trim())
          throw new Error("A classifier requires a model.");
      }
      const classifier = normalizeClassifier(assignment);
      await update(({ general, routing, touchGeneral, touchRouting }) => {
        routing.classifier = classifier;
        delete routing.classifierModel;
        touchRouting();
        if (separate && classifier === null) {
          // An explicit clear must not fall back to a legacy classifier in config.json.
          if (Object.hasOwn(general, "classifier") || Object.hasOwn(general, "classifierModel")) {
            delete general.classifier;
            delete general.classifierModel;
            touchGeneral();
          }
        }
      });
    },
    getTierWorker(tier) {
      return getRouting().tierWorkers[tier];
    },
    async setTierWorker(tier, worker) {
      if (worker?.provider === "local") throw new Error("Choose a remote worker in xarab.");
      if (![1, 2, 3].includes(tier)) throw new Error("Tier must be 1, 2, or 3.");
      if (!worker || !PROVIDERS.includes(worker.provider))
        throw new Error("Tier worker provider must be openai or openrouter.");
      const assignment = normalizeAssignment(worker);
      if (!assignment) throw new Error("Worker model must be a non-empty model ID.");
      await update(({ routing, touchRouting }) => {
        if (!isRecord(routing.tierWorkers)) routing.tierWorkers = {};
        routing.tierWorkers[tier] = assignment;
        touchRouting();
      });
    },
    async setOpenAIModel(model) {
      if (typeof model !== "string" || !model.trim())
        throw new Error("OpenAI model must be a non-empty model ID.");
      await updateGeneral((general) => {
        general.openaiModel = model.trim();
      });
    },
  };
}

export function createTieredConfigStore(
  configPath,
  routingConfigPath = path.join(path.dirname(configPath), "routing.conf"),
) {
  const storage = createRoutingStorage(configPath, routingConfigPath);
  const shared = createSharedConfig(storage);
  const settings = tieredSettings(storage);
  const get = () => ({
    ...shared.get(),
    ...settings.getRouting(),
    openaiModel: settings.getOpenAIModel(),
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
