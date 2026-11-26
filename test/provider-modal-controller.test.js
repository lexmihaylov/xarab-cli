import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createAssistantController } from "../src/agent/controller/index.js";

test("provider modal ignores an action that finishes after close and reopen", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-provider-modal-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let releaseCopy;
  let copyStarted;
  const started = new Promise((resolve) => (copyStarted = resolve));
  const gate = new Promise((resolve) => (releaseCopy = resolve));
  const controller = createAssistantController({
    mode: "tiered",
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
    clipboardWriter: async () => {
      copyStarted();
      await gate;
      return true;
    },
  });
  await controller.initialize();
  t.after(() => controller.shutdown());

  await controller.openProviderModal();
  const action = controller.providerAction("openai", "connect");
  await started;
  assert.equal(controller.getState().providerModal.busy, true);
  controller.closeProviderModal();
  assert.equal(controller.getState().providerModal, null);
  await controller.openProviderModal();
  const reopened = controller.getState().providerModal;
  assert.equal(reopened.busy, false);
  assert.equal(reopened.statuses.openai, "Not connected");
  releaseCopy();
  await action;
  assert.deepEqual(controller.getState().providerModal, reopened);
});

test("provider modal reports API key actions without exposing the key", async (t) => {
  const temporary = await mkdtemp("/tmp/opencode/xarab-provider-modal-");
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const controller = createAssistantController({
    mode: "tiered",
    root: temporary,
    workspace: temporary,
    instructionFiles: [],
    configPath: path.join(temporary, "config.json"),
  });
  await controller.initialize();
  t.after(() => controller.shutdown());

  await controller.openProviderModal();
  assert.equal(controller.getState().providerModal.statuses.tavily, "No API key saved");
  await controller.providerAction("tavily", "complete", "private-test-key");
  assert.equal(
    controller.getState().providerModal.statuses.tavily,
    "API key saved · used by web search",
  );
  assert.match(controller.getState().providerModal.feedback, /API key saved locally/);
  assert.doesNotMatch(JSON.stringify(controller.getState()), /private-test-key/);
  controller.closeProviderModal();
  await controller.openProviderModal();
  assert.equal(
    controller.getState().providerModal.statuses.tavily,
    "API key saved · used by web search",
  );
  await controller.providerAction("tavily", "disconnect");
  assert.equal(controller.getState().providerModal.statuses.tavily, "No API key saved");
  assert.equal(controller.getState().providerModal.feedback, "Disconnected locally.");
});
