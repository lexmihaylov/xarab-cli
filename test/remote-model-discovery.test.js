import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAssistantController } from "../src/agent/controller/index.js";
import { createRemoteModelDiscovery } from "../src/agent/controller/remote-model-discovery.js";

function openAIModels(id) {
  return Response.json({ models: [{ slug: id }] });
}

function openRouterModels(id) {
  return Response.json({ data: [{ id, architecture: { output_modalities: ["text"] } }] });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-remote-model-discovery-"));
  const modelsDir = path.join(root, "models");
  const configPath = path.join(root, "config.json");
  const authDir = path.join(root, "auth");
  const localModel = {
    provider: "local",
    id: path.join(modelsDir, "local.gguf"),
    name: "local.gguf",
  };
  const states = new EventEmitter();
  const requests = { "chatgpt.com": [], "openrouter.ai": [] };
  const fetchMock = t.mock.method(globalThis, "fetch", (url) => {
    const host = new URL(url).hostname;
    const pending = requests[host]?.shift();
    assert.ok(pending, `Unexpected fetch to ${host}`);
    return pending;
  });

  function queueDiscovery() {
    const openai = Promise.withResolvers();
    const openrouter = Promise.withResolvers();
    requests["chatgpt.com"].push(openai.promise);
    requests["openrouter.ai"].push(openrouter.promise);
    return { openai: openai.resolve, openrouter: openrouter.resolve };
  }

  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(modelsDir);
  await mkdir(authDir);
  await writeFile(localModel.id, "test model");
  await writeFile(configPath, JSON.stringify({ apiKeys: { openrouter: "test-key" } }));
  await writeFile(
    path.join(authDir, "openai-chatgpt.json"),
    JSON.stringify({
      provider: "openai-codex",
      access_token: "test-token",
      refresh_token: "test-refresh-token",
      account_id: "test-account",
      expires_at: Date.now() + 3_600_000,
    }),
  );

  const controller = createAssistantController({
    mode: "single",
    root,
    workspace: root,
    configPath,
    instructionFiles: [],
    onStateChange({ modelModal }) {
      states.emit("modal", modelModal);
      if (
        modelModal?.mode === "chooser" &&
        modelModal.loadingProviderModels === false &&
        modelModal.providerModelError !== undefined
      ) {
        states.emit("discovered");
      }
    },
  });
  t.after(() => controller.shutdown());
  await controller.initialize();
  return {
    controller,
    fetchMock,
    getModal: () => controller.getState().modelModal,
    localModel,
    modelsDir,
    queueDiscovery,
    states,
  };
}

async function openChooser({ controller, queueDiscovery, states }) {
  const batch = queueDiscovery();
  const discovery = once(states, "discovered");
  await controller.submit("/model");
  return { ...batch, discovery };
}

test("opening the chooser publishes loading and merges local and remote models in provider order", async (t) => {
  const f = await fixture(t);
  const published = [];
  f.states.on("modal", (modal) => published.push(modal));
  const batch = await openChooser(f);
  assert.deepEqual(
    published
      .filter((modal) => modal?.mode === "chooser")
      .map((modal) => modal.loadingProviderModels),
    [false, true],
  );
  assert.equal(f.getModal().loadingProviderModels, true);
  assert.equal(f.getModal().providerModelError, null);
  assert.deepEqual(f.getModal().models, [f.localModel]);

  batch.openrouter(openRouterModels("router-model"));
  batch.openai(openAIModels("codex-model"));
  await batch.discovery;
  assert.equal(f.getModal().loadingProviderModels, false);
  assert.equal(f.getModal().providerModelError, null);
  assert.deepEqual(f.getModal().models, [
    f.localModel,
    { provider: "openai", id: "codex-model", name: "codex-model" },
    { provider: "openrouter", id: "router-model", name: "router-model" },
  ]);
});

test("refresh replaces remote models with successful results and reports a partial failure", async (t) => {
  const f = await fixture(t);
  const initial = await openChooser(f);
  initial.openai(openAIModels("old-codex"));
  initial.openrouter(openRouterModels("old-router"));
  await initial.discovery;

  const batch = f.queueDiscovery();
  const refresh = f.controller.refreshRouterWorkerModels();
  assert.equal(f.getModal().loadingProviderModels, true);
  assert.deepEqual(
    f.getModal().models.map(({ id }) => id),
    [f.localModel.id, "old-codex", "old-router"],
  );
  batch.openai(Response.json({ error: { code: "unavailable" } }, { status: 503 }));
  batch.openrouter(openRouterModels("new-router"));
  await refresh;
  assert.equal(f.getModal().loadingProviderModels, false);
  assert.equal(
    f.getModal().providerModelError,
    "OpenAI: Could not list OpenAI models (503, unavailable).",
  );
  assert.deepEqual(f.getModal().models, [
    f.localModel,
    { provider: "openrouter", id: "new-router", name: "new-router" },
  ]);

  const retry = f.queueDiscovery();
  const retryRefresh = f.controller.refreshRouterWorkerModels();
  assert.equal(f.getModal().loadingProviderModels, true);
  assert.equal(f.getModal().providerModelError, null);
  retry.openai(openAIModels("recovered-codex"));
  retry.openrouter(openRouterModels("new-router"));
  await retryRefresh;
});

test("closing the chooser during discovery discards the result and does not publish another state", async (t) => {
  const f = await fixture(t);
  const initial = await openChooser(f);
  initial.openai(openAIModels("codex"));
  initial.openrouter(openRouterModels("router"));
  await initial.discovery;

  const batch = f.queueDiscovery();
  const refresh = f.controller.refreshRouterWorkerModels();
  f.controller.closeModelModal();
  assert.equal(f.getModal(), null);
  const published = [];
  f.states.on("modal", (modal) => published.push(modal));
  batch.openai(openAIModels("ignored-codex"));
  batch.openrouter(openRouterModels("ignored-router"));
  await refresh;
  assert.equal(f.getModal(), null);
  assert.deepEqual(published, []);
  const requestCount = f.fetchMock.mock.callCount();
  await f.controller.refreshRouterWorkerModels();
  assert.equal(f.fetchMock.mock.callCount(), requestCount);
  assert.deepEqual(published, []);
});

test("overlapping refreshes only publish the latest results, loading and error", async (t) => {
  const f = await fixture(t);
  const initial = await openChooser(f);
  initial.openai(openAIModels("initial"));
  initial.openrouter(openRouterModels("initial-router"));
  await initial.discovery;

  const older = f.queueDiscovery();
  const olderRefresh = f.controller.refreshRouterWorkerModels();
  const newer = f.queueDiscovery();
  const newerRefresh = f.controller.refreshRouterWorkerModels();
  const published = [];
  f.states.on("modal", (modal) => published.push(modal));
  older.openai(Response.json({ error: { code: "old-error" } }, { status: 503 }));
  older.openrouter(openRouterModels("old-router"));
  await olderRefresh;
  assert.equal(f.getModal().loadingProviderModels, true);
  assert.equal(f.getModal().providerModelError, null);
  assert.deepEqual(published, []);

  newer.openai(openAIModels("new-codex"));
  newer.openrouter(Response.json({}, { status: 503 }));
  await newerRefresh;
  assert.equal(f.getModal().loadingProviderModels, false);
  assert.equal(
    f.getModal().providerModelError,
    "OpenRouter: Could not list OpenRouter models (503).",
  );
  assert.deepEqual(
    f.getModal().models.map(({ id }) => id),
    [f.localModel.id, "new-codex"],
  );

  const stale = f.queueDiscovery();
  const staleRefresh = f.controller.refreshRouterWorkerModels();
  const latest = f.queueDiscovery();
  const latestRefresh = f.controller.refreshRouterWorkerModels();
  latest.openai(openAIModels("latest-codex"));
  latest.openrouter(openRouterModels("latest-router"));
  await latestRefresh;
  const publishedCount = published.length;
  stale.openai(openAIModels("stale-codex"));
  stale.openrouter(openRouterModels("stale-router"));
  await staleRefresh;
  assert.equal(published.length, publishedCount);
  assert.equal(f.getModal().providerModelError, null);
  assert.deepEqual(
    f.getModal().models.map(({ id }) => id),
    [f.localModel.id, "latest-codex", "latest-router"],
  );
});

test("a reopened chooser rejects an old result even before its own discovery starts", async (t) => {
  const response = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", () => response.promise);
  let identity = 1;
  let modal = { mode: "chooser", models: [] };
  let notifications = 0;
  const load = createRemoteModelDiscovery({
    getCredentials: async () => ({ access_token: "token", account_id: "account" }),
    getOpenRouterApiKey: () => null,
    getModelModal: () => modal,
    getChooserIdentity: () => identity,
    setModelModal: (value) => {
      modal = value;
    },
    notify: () => {
      notifications++;
    },
  });
  const pending = load();
  identity++;
  modal = { mode: "chooser", models: [{ provider: "local", id: "new" }] };
  response.resolve(openAIModels("stale"));
  await pending;
  assert.deepEqual(modal, { mode: "chooser", models: [{ provider: "local", id: "new" }] });
  assert.equal(notifications, 1);
});

test("an older discovery finishing after reopen cannot update the new chooser", async (t) => {
  const f = await fixture(t);
  const initial = await openChooser(f);
  initial.openai(openAIModels("codex"));
  initial.openrouter(openRouterModels("router"));
  await initial.discovery;

  const older = f.queueDiscovery();
  const olderRefresh = f.controller.refreshRouterWorkerModels();
  f.controller.closeModelModal();
  await rm(f.localModel.id);
  const newLocal = path.join(f.modelsDir, "replacement.gguf");
  await writeFile(newLocal, "replacement model");
  const newer = await openChooser(f);
  newer.openai(openAIModels("newer-codex"));
  newer.openrouter(openRouterModels("newer-router"));
  await newer.discovery;
  assert.deepEqual(
    f.getModal().models.map(({ id }) => id),
    [newLocal, "newer-codex", "newer-router"],
  );

  older.openai(openAIModels("older-codex"));
  older.openrouter(openRouterModels("older-router"));
  await olderRefresh;
  assert.deepEqual(
    f.getModal().models.map(({ id }) => id),
    [newLocal, "newer-codex", "newer-router"],
  );
});
