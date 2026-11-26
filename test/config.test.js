import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSingleConfigStore } from "../src/single/utils/config-store.js";
import { createTieredConfigStore } from "../src/tiered/utils/config-store.js";

test("loads classifier model labels and ignores obsolete local worker selection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-config-test-"));
  const configPath = path.join(directory, "config.json");
  const modelPath = path.join(directory, "coder.gguf");
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        lastModel: modelPath,
        models: {
          [modelPath]: { name: "My Classifier", contextSize: 24_576, customSetting: true },
        },
        apiKeys: { tavily: "test-key" },
      }),
    );
    const store = createSingleConfigStore(configPath);
    await store.load();
    assert.deepEqual(store.getModel(modelPath), { name: "My Classifier", contextSize: 24_576 });
    assert.equal(store.getApiKey("tavily"), "test-key");

    assert.equal(store.get().lastModel, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("starts with empty defaults when the config file does not exist", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-config-test-"));
  try {
    const store = createTieredConfigStore(path.join(directory, "config.json"));
    await store.load();
    assert.deepEqual(store.get(), {
      apiKeys: {},
      openaiModel: null,
      classifier: null,
      tierWorkers: {
        1: { provider: "openai" },
        2: { provider: "openai" },
        3: { provider: "openai" },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists OpenRouter classifier and worker assignments", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-openrouter-routing-"));
  const configPath = path.join(directory, "config.json");
  try {
    const store = createTieredConfigStore(configPath);
    await store.load();
    await store.setClassifier({ provider: "openrouter", model: "vendor/router" });
    await store.setTierWorker(1, { provider: "openrouter", model: "vendor/worker" });
    const restored = createTieredConfigStore(configPath);
    await restored.load();
    assert.deepEqual(restored.getClassifier(), { provider: "openrouter", model: "vendor/router" });
    assert.deepEqual(restored.getTierWorker(1), { provider: "openrouter", model: "vendor/worker" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tiered settings reject new local assignments", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-config-routing-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createTieredConfigStore(path.join(directory, "config.json"));
  const local = { provider: "local", model: path.join(directory, "local.gguf") };
  await store.load();
  await assert.rejects(store.setClassifier(local), /remote/);
  await assert.rejects(store.setTierWorker(2, local), /remote/);
});

test("stores router assignments in a separate routing.conf", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-routing-conf-test-"));
  const configPath = path.join(directory, "router", "config.json");
  const routingConfigPath = path.join(directory, "xarab", "routing.conf");
  try {
    const store = createTieredConfigStore(configPath, routingConfigPath);
    await store.load();
    await store.setClassifier({ provider: "openrouter", model: "vendor/router" });
    await store.setTierWorker(1, { provider: "openai", model: "gpt-tier-1" });

    const routingConfig = JSON.parse(await readFile(routingConfigPath, "utf8"));
    assert.deepEqual(routingConfig.classifier, {
      provider: "openrouter",
      model: "vendor/router",
    });
    assert.deepEqual(routingConfig.tierWorkers[1], {
      provider: "openai",
      model: "gpt-tier-1",
    });
    await store.setOpenAIModel("gpt-6-astra");
    const generalConfig = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(generalConfig.openaiModel, "gpt-6-astra");
    assert.equal(Object.hasOwn(generalConfig, "classifierModel"), false);
    assert.equal(Object.hasOwn(generalConfig, "tierWorkers"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrates legacy router settings out of the general config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-routing-migration-test-"));
  const configPath = path.join(directory, "config.json");
  const routingConfigPath = path.join(directory, "routing.conf");
  const classifierPath = path.join(directory, "smollm.gguf");
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        openaiModel: "gpt-6-astra",
        classifierModel: classifierPath,
        tierWorkers: { 1: { provider: "local", model: "/models/coder.gguf" } },
      }),
    );
    const store = createTieredConfigStore(configPath, routingConfigPath);
    await store.load();

    assert.deepEqual(store.getClassifier(), {
      provider: "local",
      model: classifierPath,
    });
    assert.deepEqual(store.getTierWorker(1), {
      provider: "local",
      model: path.resolve("/models/coder.gguf"),
    });
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).openaiModel, "gpt-6-astra");
    assert.deepEqual(JSON.parse(await readFile(routingConfigPath, "utf8")).tierWorkers[1], {
      provider: "local",
      model: path.resolve("/models/coder.gguf"),
    });
    const migrated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(Object.hasOwn(migrated, "classifierModel"), false);
    assert.equal(Object.hasOwn(migrated, "tierWorkers"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stores and removes provider API keys in a dedicated config section", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-config-test-"));
  const configPath = path.join(directory, "config.json");
  try {
    const store = createTieredConfigStore(configPath);
    await store.load();
    await store.setApiKey("tavily", "  replacement-key  ");
    assert.equal(store.getApiKey("tavily"), "replacement-key");
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).apiKeys, {
      tavily: "replacement-key",
    });

    await store.removeApiKey("tavily");
    assert.equal(store.getApiKey("tavily"), undefined);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).apiKeys, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ignores malformed API key entries when loading config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-config-test-"));
  const configPath = path.join(directory, "config.json");
  try {
    await writeFile(
      configPath,
      JSON.stringify({ apiKeys: { tavily: "valid", "bad key": "ignored", exa: 7 } }),
    );
    const store = createTieredConfigStore(configPath);
    await store.load();
    assert.deepEqual(store.get().apiKeys, { tavily: "valid" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("adds downloaded models and removes deleted models from persistent config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-config-test-"));
  const configPath = path.join(directory, "config.json");
  const modelPath = path.join(directory, "downloaded.gguf");
  try {
    const store = createSingleConfigStore(configPath);
    await store.load();
    await store.ensureModel(modelPath);
    assert.deepEqual(store.getModel(modelPath), {});

    await store.removeModel(modelPath);
    assert.equal(store.getModel(modelPath).name, undefined);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")).models, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("round-trips and clears the standalone assignment independently of legacy OpenAI settings", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-single-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.json");
  const store = createSingleConfigStore(configPath);
  const restored = createSingleConfigStore(configPath);
  await writeFile(configPath, JSON.stringify({ openaiModel: "legacy-default" }));
  assert.equal(store.getSingleModel(), null);
  await assert.rejects(store.setSingleModel({ provider: "unknown", model: "m" }), /single model/);
  await assert.rejects(store.setSingleModel({ provider: "openai", model: " " }), /single model/);

  for (const [input, expected] of [
    [
      { provider: "openrouter", model: " vendor/worker ", effort: " high " },
      { provider: "openrouter", model: "vendor/worker", effort: "high" },
    ],
    [
      { provider: "openai", model: "gpt-worker", effort: "medium" },
      { provider: "openai", model: "gpt-worker", effort: "medium" },
    ],
    [
      { provider: "local", model: " models/worker.gguf ", effort: "high" },
      { provider: "local", model: path.resolve("models/worker.gguf") },
    ],
  ]) {
    await store.setSingleModel(input);
    await restored.load();
    assert.deepEqual(store.getSingleModel(), expected);
    assert.deepEqual(restored.getSingleModel(), expected);
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).openaiModel, "legacy-default");
  }
  await store.setSingleModel(null);
  await restored.load();
  assert.equal(restored.getSingleModel(), null);
  assert.deepEqual(await readdir(directory), ["config.json"]);
});

test("concurrent startup migration and writes preserve standalone and routing settings", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-concurrent-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.json");
  const routingPath = path.join(directory, "routing.conf");
  await writeFile(
    configPath,
    JSON.stringify({
      classifierModel: "classifier.gguf",
      tierWorkers: { 1: { provider: "openai", model: "tier-one" } },
      automaticTitles: false,
    }),
  );
  const standalone = createSingleConfigStore(configPath);
  const migration = createTieredConfigStore(configPath, routingPath);
  const tier = createTieredConfigStore(configPath, routingPath);
  const assignment = { provider: "openrouter", model: "vendor/worker", effort: "high" };
  await Promise.all([
    migration.load(),
    standalone.setSingleModel(assignment),
    tier.setTierWorker(2, assignment),
  ]);
  await tier.load();
  assert.deepEqual(tier.getClassifier(), {
    provider: "local",
    model: path.resolve("classifier.gguf"),
  });
  assert.deepEqual(tier.getTierWorker(1), { provider: "openai", model: "tier-one" });
  assert.deepEqual(tier.getTierWorker(2), assignment);
  await standalone.load();
  assert.deepEqual(standalone.getSingleModel(), assignment);
  assert.equal(tier.getSingleModel, undefined);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    automaticTitles: false,
    singleModel: assignment,
  });
});

test(
  "standalone and tier processes merge updates made from stale snapshots",
  { timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-concurrent-config-"));
    const configPath = path.join(directory, "config.json");
    const routingPath = path.join(directory, "routing.conf");
    const oldModel = path.join(directory, "old.gguf");
    const newModel = path.join(directory, "new.gguf");
    const keptModel = path.join(directory, "kept.gguf");
    const children = [];
    t.after(async () => {
      for (const child of children) child.kill();
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(
      configPath,
      JSON.stringify({
        automaticSuggestions: false,
        models: { [oldModel]: {}, [keptModel]: { name: "Kept", futureField: 42 } },
        apiKeys: { obsolete: "remove-me" },
      }),
    );
    await writeFile(
      routingPath,
      JSON.stringify({
        tierWorkers: { 3: { provider: "openai", model: "keep-tier", futureField: true } },
        customRouting: { keep: true },
      }),
    );

    const singleModule = new URL("../src/single/utils/config-store.js", import.meta.url).href;
    const tieredModule = new URL("../src/tiered/utils/config-store.js", import.meta.url).href;
    const script = `
    import { once } from "node:events";
    import { createSingleConfigStore } from ${JSON.stringify(singleModule)};
    import { createTieredConfigStore } from ${JSON.stringify(tieredModule)};
    const [configPath, routingPath, updates] = process.argv.slice(1);
    const store = routingPath ? createTieredConfigStore(configPath, routingPath) : createSingleConfigStore(configPath);
    await store.load();
    const start = once(process, "message");
    process.send("ready");
    await start;
    await Promise.all(JSON.parse(updates).map(([method, ...args]) => store[method](...args)));
    process.disconnect();
  `;
    function startProcess(routingPath, updates) {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script, configPath, routingPath, JSON.stringify(updates)],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      children.push(child);
      const exited = once(child, "exit");
      const ready = Promise.race([
        once(child, "message").then(([message]) => assert.equal(message, "ready")),
        exited.then(([code, signal]) =>
          assert.fail(`Writer exited before ready (${code ?? signal})`),
        ),
      ]);
      return { child, ready, exited };
    }
    const assignment = { provider: "openrouter", model: "vendor/worker", effort: "high" };
    const writers = [
      startProcess("", [
        ["setSingleModel", assignment],
        ["setApiKey", "openrouter", "router-key"],
        ["ensureModel", newModel],
        ["removeModel", oldModel],
      ]),
      startProcess(routingPath, [
        ["setTierWorker", 1, assignment],
        ["setApiKey", "tavily", "search-key"],
      ]),
      startProcess(routingPath, [
        ["setTierWorker", 2, { provider: "openai", model: "tier-two" }],
        ["setClassifier", { provider: "openai", model: "classifier" }],
        ["removeApiKey", "obsolete"],
      ]),
    ];
    await Promise.all(writers.map(({ ready }) => ready));
    for (const { child } of writers) child.send("write");
    assert.deepEqual(await Promise.all(writers.map(({ exited }) => exited)), [
      [0, null],
      [0, null],
      [0, null],
    ]);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
      automaticSuggestions: false,
      models: { [keptModel]: { name: "Kept", futureField: 42 }, [newModel]: {} },
      apiKeys: { openrouter: "router-key", tavily: "search-key" },
      singleModel: assignment,
    });
    assert.deepEqual(JSON.parse(await readFile(routingPath, "utf8")), {
      tierWorkers: {
        1: assignment,
        2: { provider: "openai", model: "tier-two" },
        3: { provider: "openai", model: "keep-tier", futureField: true },
      },
      classifier: { provider: "openai", model: "classifier" },
      customRouting: { keep: true },
    });
    assert.deepEqual((await readdir(directory)).sort(), ["config.json", "routing.conf"]);
  },
);

test("rejects a write over malformed JSON and allows the next mutation after repair", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-malformed-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.json");
  const store = createSingleConfigStore(configPath);
  await store.load();
  await writeFile(configPath, "{broken");
  const assignment = { provider: "openai", model: "worker" };
  await assert.rejects(store.setSingleModel(assignment), SyntaxError);
  assert.equal(store.getSingleModel(), null);
  assert.equal(await readFile(configPath, "utf8"), "{broken");
  await writeFile(configPath, JSON.stringify({ automaticTitles: false }));
  await store.setSingleModel(assignment);
  assert.deepEqual(store.getSingleModel(), assignment);
  assert.equal(store.get().automaticTitles, false);
});

test("single config neither reads nor migrates tier routing", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xarab-isolated-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.json");
  const routingPath = path.join(directory, "routing.conf");
  const legacy = { classifierModel: "old-router.gguf" };
  const assignment = { provider: "openai", model: "direct" };
  await writeFile(configPath, JSON.stringify(legacy));
  const single = createSingleConfigStore(configPath);
  const tiered = createTieredConfigStore(configPath);
  await single.load();
  await single.setSingleModel(assignment);
  assert.deepEqual(await readdir(directory), ["config.json"]);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    ...legacy,
    singleModel: assignment,
  });
  assert.equal(single.getClassifier, undefined);
  assert.equal(tiered.ensureModel, undefined);

  await writeFile(routingPath, "{invalid");
  assert.deepEqual((await single.load()).singleModel, assignment);
  await single.setApiKey("openrouter", "key");
  await assert.rejects(tiered.load(), SyntaxError);
  assert.equal(await readFile(routingPath, "utf8"), "{invalid");
  await rm(routingPath);

  await tiered.load();
  assert.deepEqual(tiered.getClassifier(), {
    provider: "local",
    model: path.resolve(legacy.classifierModel),
  });
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    singleModel: assignment,
    apiKeys: { openrouter: "key" },
  });
});
