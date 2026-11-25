import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantController } from "../src/agent/controller.js";
import { singleAppPolicy } from "../src/single/app-policy.js";
import { tieredAppPolicy } from "../src/tiered/app-policy.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

test("controller owns command handling and publishes updated UI state", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-controller-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const states = [];
  let quitRequested = false;
  let copiedAuthorizationUrl;
  const controller = createAssistantController({
    mode: "tiered",
    automaticTitles: false,
    root: process.cwd(),
    workspace: process.cwd(),
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
    clipboardWriter: async (url) => {
      copiedAuthorizationUrl = url;
      return true;
    },
    onStateChange: (state) => states.push(state),
    onQuit: () => {
      quitRequested = true;
    },
  });

  await controller.initialize();
  assert.equal(controller.getState().model, undefined);
  assert.equal(controller.getState().classifier, null);
  assert.equal(controller.getState().messages.length, 0);

  await controller.submit("/help");
  assert.match(controller.getState().messages.at(-1).message, /\/route/);
  assert.match(controller.getState().messages.at(-1).message, /\/connect/);
  assert.match(controller.getState().messages.at(-1).message, /\/exit/);
  assert.doesNotMatch(controller.getState().messages.at(-1).message, /\/quit/);
  assert.ok(states.length > 0);

  await controller.submit("/connect");
  assert.equal(controller.getState().providerModal.statuses.openai, "Not connected");
  assert.equal(controller.getState().providerModal.statuses.openrouter, "No API key saved");
  await controller.providerAction("openrouter", "complete", "test-secret-key");
  assert.equal(
    controller.getState().providerModal.statuses.openrouter,
    "API key saved · verify by refreshing models in /route",
  );
  assert.doesNotMatch(JSON.stringify(controller.getState()), /test-secret-key/);
  assert.equal(
    JSON.parse(await readFile(path.join(temporary, "config.json"), "utf8")).apiKeys.openrouter,
    "test-secret-key",
  );
  await controller.providerAction("openrouter", "disconnect");
  assert.equal(controller.getState().providerModal.statuses.openrouter, "No API key saved");
  await controller.providerAction("openai", "connect");
  assert.match(copiedAuthorizationUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.equal(controller.getState().providerModal.pending.copied, true);
  await controller.providerAction("openai", "copy");
  controller.closeProviderModal();
  assert.equal(controller.getState().providerModal, null);

  await controller.submit("/route");
  assert.equal(controller.getState().modelModal.mode, "chooser");
  controller.closeModelModal();
  await controller.submit("/download");
  assert.equal(controller.getState().modelModal, null);

  await controller.submit("/exit");
  assert.equal(quitRequested, true);
  await controller.shutdown();
});

test("follow-ups run in FIFO order and remain pending after interruption", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-queue-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let release;
  let started;
  let gate = new Promise((resolve) => (release = resolve));
  let ready = new Promise((resolve) => (started = resolve));
  const prompts = [];
  const controller = createAssistantController({
    mode: "tiered",
    automaticTitles: false,
    automaticSuggestions: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
    classifierFactory: () => ({
      load: async () => {},
      dispose: async () => {},
      classify: async ({ prompt }) => {
        prompts.push(prompt);
        if (prompts.length === 1 || prompts.length === 4) {
          started();
          await gate;
        }
        return { valid: true, tier: 1, rationale: "Routine" };
      },
    }),
    openAIAdapterFactory: () => ({ dispose: async () => {}, run: async () => ({}) }),
  });
  await controller.initialize();
  t.after(() => controller.shutdown());
  await controller.setRouterClassifier({ provider: "openai", model: "classifier" });
  await controller.setRouterTierWorker(1, { provider: "openai", model: "small.gguf" });
  const first = controller.submit("first");
  await ready;
  await controller.submit("second");
  await controller.submit("third");
  assert.deepEqual(
    controller.getState().queuedMessages.map((item) => item.text),
    ["second", "third"],
  );
  release();
  await first;
  assert.deepEqual(prompts, ["first", "second", "third"]);
  assert.equal(controller.getState().queuedMessages.length, 0);

  gate = new Promise((resolve) => (release = resolve));
  ready = new Promise((resolve) => (started = resolve));
  const interrupted = controller.submit("fourth");
  await ready;
  await controller.submit("fifth");
  controller.stopGeneration();
  release();
  await interrupted;
  assert.deepEqual(
    controller.getState().queuedMessages.map((item) => item.text),
    ["fifth"],
  );
  await controller.submit("sixth");
  assert.deepEqual(prompts, ["first", "second", "third", "fourth", "fifth", "sixth"]);
});

test("manual shell commands persist command, output, and severity", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-shell-test-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const controller = createAssistantController({
    mode: "tiered",
    automaticTitles: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
  });
  await controller.initialize();

  await controller.submit("!printf success-output");
  const success = controller.getState().messages.at(-1);
  assert.deepEqual(
    {
      type: success.type,
      command: success.command,
      severity: success.severity,
    },
    { type: "shell", command: "printf success-output", severity: "info" },
  );
  assert.match(success.message, /success-output/);

  await controller.submit("!false");
  const warning = controller.getState().messages.at(-1);
  assert.equal(warning.type, "shell");
  assert.equal(warning.command, "false");
  assert.equal(warning.severity, "warning");

  await controller.submit("!command-that-does-not-exist-xarab");
  const failure = controller.getState().messages.at(-1);
  assert.equal(failure.type, "shell");
  assert.equal(failure.command, "command-that-does-not-exist-xarab");
  assert.equal(failure.severity, "warning");

  await controller.shutdown();
});

test("publishes a running shell message before command completion", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-shell-running-test-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const controller = createAssistantController({
    mode: "tiered",
    automaticTitles: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
  });
  await controller.initialize();

  const pending = controller.submit("!sleep 0.1");
  const running = controller.getState();
  assert.equal(running.commandRunning, true);
  assert.equal(running.messages.at(-1).type, "shell");
  assert.equal(running.messages.at(-1).command, "sleep 0.1");
  assert.equal(running.messages.at(-1).message, "");
  assert.equal(running.messages.at(-1).running, true);

  await pending;
  const completed = controller.getState();
  assert.equal(completed.commandRunning, false);
  assert.equal(completed.messages.at(-1).running, undefined);
  assert.match(completed.messages.at(-1).message, /exit code 0/);
  await controller.shutdown();
});

test("manual shell output is published while the command is running", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-shell-stream-test-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const controller = createAssistantController({
    mode: "tiered",
    automaticTitles: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
  });
  await controller.initialize();
  const pending = controller.submit("!printf early; printf problem >&2; sleep 2; printf late");
  try {
    let running;
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      running = controller.getState().messages.at(-1);
      if (running.message.includes("early") && running.message.includes("problem")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(running.running, true);
    assert.match(running.message, /stdout:\nearly/);
    assert.match(running.message, /stderr:\nproblem/);
    assert.doesNotMatch(running.message, /late/);
  } finally {
    await pending;
    await controller.shutdown();
  }
  const completed = controller.getState().messages.at(-1);
  assert.equal(completed.running, undefined);
  assert.match(completed.message, /exit code 0/);
  assert.match(completed.message, /earlylate/);
  assert.match(completed.message, /problem/);
});

test("controller reassesses remaining work and records adjustment outcomes", async (t) => {
  for (const outcome of ["approved", "same-model", "rejected"]) {
    await t.test(outcome, async (t) => {
      const temporary = await mkdtemp("/tmp/opencode/xarab-adjustment-");
      t.after(() => rm(temporary, { recursive: true, force: true }));
      let classifications = 0;
      let runs = 0;
      const controller = createAssistantController({
        mode: "tiered",
        automaticTitles: false,
        root: temporary,
        workspace: temporary,
        instructionFiles: [],
        configPath: path.join(temporary, "config.json"),
        classifierFactory: () => ({
          load: async () => {},
          dispose: async () => {},
          classify: async ({ prompt }) => {
            classifications++;
            if (classifications > 1) {
              assert.match(prompt, /current tier is 1/);
              assert.match(prompt, /Reassess only the remaining work/);
            }
            return {
              valid: true,
              tier: classifications === 1 || outcome === "rejected" ? 1 : 3,
              rationale: "Coupled invariants",
            };
          },
        }),
        openAIAdapterFactory: () => ({
          dispose: async () => {},
          run: async ({ tools }) => {
            runs++;
            if (runs > 1) {
              assert.equal(tools.tier_adjustment, undefined);
              return {};
            }
            const result = await tools.tier_adjustment.handler({
              direction: "up",
              reason: "Cancellation races with retries",
              findings: "Competing interleavings violate commit invariants",
              requested_capability: "concurrency reasoning",
            });
            return result.handoff ? { handoff: result.handoff } : {};
          },
        }),
      });
      await controller.initialize();
      t.after(() => controller.shutdown());
      await controller.setRouterClassifier({ provider: "openai", model: "classifier" });
      await controller.setRouterTierWorker(1, { provider: "openai", model: "small.gguf" });
      await controller.setRouterTierWorker(2, { provider: "openai", model: "medium.gguf" });
      await controller.setRouterTierWorker(3, {
        provider: "openai",
        model: outcome === "same-model" ? "small.gguf" : "large.gguf",
      });
      await controller.submit("Investigate duplicate commits");
      assert.equal(runs, outcome === "approved" ? 2 : 1);
      const transcript = controller
        .getState()
        .messages.map((message) => message.message)
        .join("\n");
      assert.match(transcript, /Tier adjustment requested \(up\)/);
      if (outcome === "same-model") assert.match(transcript, /same worker model/);
      if (outcome === "approved") assert.match(transcript, /adjusted from 1 to 3/);
      if (outcome === "rejected") assert.match(transcript, /no suitable tier/);
    });
  }
});

test("classification failure and cancellation clear the message spinner", async (t) => {
  for (const outcome of ["throw", "invalid", "cancel", "success"]) {
    await t.test(outcome, async (t) => {
      const temporary = await mkdtemp("/tmp/opencode/xarab-classification-");
      t.after(() => rm(temporary, { recursive: true, force: true }));
      let started;
      const ready = new Promise((resolve) => (started = resolve));
      const states = [];
      const controller = createAssistantController({
        mode: "tiered",
        automaticTitles: false,
        root: temporary,
        workspace: temporary,
        instructionFiles: [],
        configPath: path.join(temporary, "config.json"),
        onStateChange: (state) =>
          states.push(state.messages.map((message) => message.classification?.status)),
        classifierFactory: () => ({
          load: async () => {},
          dispose: async () => {},
          classify: async ({ signal }) => {
            started();
            if (outcome === "throw") throw new Error("classifier unavailable");
            if (outcome === "invalid") return { valid: false, error: "invalid tier" };
            if (outcome === "cancel") {
              await new Promise((resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")), {
                  once: true,
                });
              });
            }
            return { valid: true, tier: 1, rationale: "Routine" };
          },
        }),
        openAIAdapterFactory: () => ({ dispose: async () => {}, run: async () => ({}) }),
      });
      await controller.initialize();
      t.after(() => controller.shutdown());
      await controller.setRouterClassifier({ provider: "openai", model: "classifier" });
      await controller.setRouterTierWorker(1, { provider: "openai", model: "small.gguf" });
      const pending = controller.submit("Hello");
      await ready;
      if (outcome === "cancel") controller.stopGeneration();
      await pending;
      const state = controller.getState();
      const user = state.messages.find((message) => message.type === "user");
      const expected =
        outcome === "cancel" ? "cancelled" : outcome === "success" ? "done" : "error";
      assert.equal(user.classification.status, expected);
      assert.ok(states.some((statuses) => statuses.includes(expected)));
      assert.equal(state.generating, false);
      const error = state.messages.find((message) => message.severity === "error");
      if (outcome === "throw") assert.match(error.message, /classifier unavailable/);
      else if (outcome === "invalid") assert.match(error.message, /invalid tier/);
      else assert.equal(error, undefined);
    });
  }
});
test("selecting a classifier loads it and persists classifier configuration", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-model-test-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const loadedModels = [];
  const controller = createAssistantController({
    mode: "tiered",
    automaticTitles: false,
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
    classifierFactory({ getAssignment }) {
      return {
        async load() {
          loadedModels.push(getAssignment().model);
        },
        async dispose() {},
      };
    },
  });
  await controller.initialize();
  await controller.setRouterClassifier({ provider: "openai", model: "classifier" });

  assert.deepEqual(loadedModels, ["classifier"]);
  assert.deepEqual(controller.getState().classifier, {
    provider: "openai",
    model: "classifier",
  });
  assert.equal(controller.getState().modelModal, null);
  const routingConfig = JSON.parse(await readFile(path.join(temporary, "routing.conf"), "utf8"));
  assert.deepEqual(routingConfig.classifier, {
    provider: "openai",
    model: "classifier",
  });
  await controller.shutdown();
});

test("single mode uses the selected local model for chat and compaction, without routing or task tools", async (t) => {
  const root = await mkdtemp("/tmp/opencode/xarab-single-controller-");
  const requests = [];
  const controller = createAssistantController({
    mode: "single",
    appPolicy: singleAppPolicy,
    root,
    workspace: root,
    configPath: path.join(root, "config.json"),
    automaticTitles: false,
    automaticSuggestions: false,
    classifierFactory: () => assert.fail("Single mode must never initialize the classifier"),
    localWorkerAdapterFactory: () => ({
      async run(request) {
        requests.push(request);
        request.onText("Result from the selected model");
      },
    }),
  });
  t.after(async () => {
    await controller.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  await controller.initialize();
  await controller.submit("Not configured yet");
  assert.match(controller.getState().messages.at(-1).message, /\/model/);
  const model = path.join(root, "model.gguf");
  await controller.setSingleModel({ provider: "local", model });
  await controller.submit("Use this model directly");
  await controller.submit("Another direct turn");
  await controller.submit("/compact");
  assert.deepEqual(
    requests.map((request) => request.model),
    [model, model, model],
  );
  assert.ok(requests[0].tools.read_file);
  assert.equal(requests[0].tools.task, undefined);
  assert.equal(requests[0].tools.tier_adjustment, undefined);
  assert.deepEqual(requests[2].tools, {});
  assert.match(controller.getState().messages.at(-1).message, /Result from the selected model/);
});

test("local context occupancy triggers compaction only after a successful turn at the threshold", async (t) => {
  const root = await mkdtemp("/tmp/opencode/xarab-local-compact-");
  let occupancy = 84;
  let fail = false;
  const requests = [];
  const controller = createAssistantController({
    mode: "single",
    appPolicy: singleAppPolicy,
    root,
    workspace: root,
    configPath: path.join(root, "config.json"),
    automaticTitles: false,
    automaticSuggestions: false,
    localWorkerAdapterFactory: () => ({
      async run(request) {
        requests.push(request);
        if (Object.keys(request.tools).length) {
          request.onEvent({ type: "local_context_usage", contextSize: 100, occupiedTokens: occupancy });
          if (fail) throw new Error("generation failed");
        }
        request.onText("Response");
      },
    }),
  });
  t.after(async () => {
    await controller.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  await controller.initialize();
  await controller.setSingleModel({ provider: "local", model: path.join(root, "model.gguf") });
  await controller.submit("Below threshold");
  assert.equal(requests.length, 1);
  occupancy = 85;
  fail = true;
  await controller.submit("Failed turn");
  assert.equal(requests.length, 2);
  fail = false;
  await controller.submit("At threshold");
  assert.equal(requests.length, 4);
  assert.deepEqual(requests[3].tools, {});
  assert.ok(controller.getState().messages.some((message) => message.autoCompactSummary));
});

test("tier mode rejects a legacy local classifier before creating its runtime", async (t) => {
  const root = await mkdtemp("/tmp/opencode/xarab-tier-controller-");
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ classifierModel: path.join(root, "legacy.gguf") }));
  const controller = createAssistantController({
    mode: "tiered",
    appPolicy: tieredAppPolicy,
    root,
    workspace: root,
    configPath,
    classifierFactory: () => assert.fail("Local classifier must not start in tier mode"),
  });
  t.after(async () => {
    await controller.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  await controller.initialize();
  await controller.submit("Use the legacy route");
  assert.match(
    controller.getState().messages.at(-1).message,
    /Local classifiers are unavailable.*\/route/,
  );
});
