import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantController } from "../src/agent/controller.js";

test("single-mode deletion waits for unload, blocks new work, and clears the selected assignment", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-delete-controller-"));
  const model = path.join(root, "selected.gguf");
  const configPath = path.join(root, "config.json");
  await writeFile(model, "fixture");
  const started = Promise.withResolvers();
  const finishRun = Promise.withResolvers();
  const unloading = Promise.withResolvers();
  const finishUnload = Promise.withResolvers();
  let runs = 0;
  const controller = createAssistantController({
    mode: "single",
    root,
    workspace: root,
    modelsDir: root,
    configPath,
    automaticTitles: false,
    automaticSuggestions: false,
    instructionFiles: [],
    localWorkerAdapterFactory: () => ({
      async run(request) {
        runs++;
        started.resolve();
        await finishRun.promise;
        request.onText("Done");
      },
      async dispose() {
        unloading.resolve();
        await finishUnload.promise;
      },
    }),
  });
  t.after(async () => {
    finishRun.resolve();
    finishUnload.resolve();
    await controller.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  await controller.initialize();
  await controller.setSingleModel({ provider: "local", model });
  await controller.submit("/model");
  const turn = controller.submit("Run the model");
  await started.promise;
  assert.equal((await controller.deleteModel(model)).deleted, false);
  assert.equal(await readFile(model, "utf8"), "fixture");
  finishRun.resolve();
  await turn;

  const deletion = controller.deleteModel(model);
  await unloading.promise;
  await controller.submit("/compact");
  await controller.submit("Do not start another run");
  await controller.setSingleModel({ provider: "openai", model: "replacement" });
  assert.equal(runs, 1);
  assert.equal(controller.getState().singleModel.model, model);
  assert.equal(await readFile(model, "utf8"), "fixture");
  controller.closeModelModal();
  finishUnload.resolve();
  assert.deepEqual(await deletion, { deleted: true, clearedSingleModel: true, error: null });
  await assert.rejects(readFile(model), { code: "ENOENT" });
  assert.equal(controller.getState().singleModel, null);
  assert.match(controller.getState().status, /choose a model/i);
});

test("cancelled validation keeps the model in use until the adapter finishes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-validation-drain-"));
  const model = path.join(root, "selected.gguf");
  await writeFile(model, "fixture");
  const validating = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let disposed = false;
  const controller = createAssistantController({
    mode: "single",
    root,
    workspace: root,
    modelsDir: root,
    configPath: path.join(root, "config.json"),
    automaticTitles: false,
    automaticSuggestions: false,
    instructionFiles: [],
    localWorkerAdapterFactory: () => ({
      async run({ tools, signal }) {
        await tools.run_command.handler({ command: "printf fixture" }, { signal });
      },
      async runValidation({ signal }) {
        validating.resolve(signal);
        await finish.promise;
      },
      dispose() {
        disposed = true;
      },
    }),
  });
  t.after(async () => {
    finish.resolve();
    await controller.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  await controller.initialize();
  await controller.setSingleModel({ provider: "local", model });
  await controller.submit("/model");
  const turn = controller.submit("Check the fixture");
  const signal = await validating.promise;
  controller.stopGeneration();
  await turn;
  assert.equal(signal.aborted, true);
  assert.equal(controller.getState().questionDialog, undefined);
  await controller.setSingleModel({ provider: "openai", model: "replacement" });
  assert.equal(controller.getState().singleModel.model, model);
  assert.equal((await controller.deleteModel(model)).deleted, false);
  assert.equal(await readFile(model, "utf8"), "fixture");
  const closing = controller.shutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, false);
  finish.resolve();
  await closing;
  assert.equal(disposed, true);
});

test("tiered controllers do not expose local model deletion", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xarab-tier-delete-"));
  const controller = createAssistantController({
    mode: "tiered",
    root,
    configPath: path.join(root, "config.json"),
  });
  t.after(async () => {
    await controller.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(controller.deleteModel, undefined);
});
