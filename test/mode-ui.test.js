import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { SingleModelChooser } from "../src/single/components/SingleModelChooser.component.jsx";
import { ModelChooser } from "../src/tiered/components/ModelChooser/index.tsx";
import { createCommandHandler } from "../src/agent/assistant-command-handler.js";

test("single chooser selects a local model", async () => {
  const selected = [];
  const view = await testRender(
    React.createElement(SingleModelChooser, {
      models: [{ provider: "local", id: "/model.gguf", name: "local model" }],
      onClose() {},
      onSetSingleModel: (value) => selected.push(value),
    }),
    { width: 80, height: 24 },
  );
  try {
    await view.flush();
    assert.match(view.captureCharFrame(), /local model/);
    await act(async () => view.mockInput.pressEnter());
    assert.deepEqual(selected, [{ provider: "local", model: "/model.gguf" }]);
  } finally {
    await view.dispose();
  }
});

test("single chooser keeps filtered and scrolled models inside its pane", async () => {
  for (const height of [24, 18]) {
    const models = Array.from({ length: 40 }, (_, i) => ({
      provider: "local",
      id: `/model-${i}.gguf`,
      name: `item-${String(i).padStart(2, "0")}`,
    }));
    const view = await testRender(
      React.createElement(SingleModelChooser, {
        models,
        onClose() {},
        onSetSingleModel() {},
      }),
      { width: 80, height },
    );
    const checkFrame = (selected) => {
      const lines = view.captureCharFrame().split("\n");
      const title = lines.findIndex((line) => line.includes("MODEL SELECTION"));
      const heading = lines.findIndex((line) => /^\s*│\s*MODEL\s*│/.test(line));
      const bottom = lines.findIndex((line) => line.includes("╰") && line.includes("╯"));
      const selectedLine = lines.findIndex((line) => line.includes(`› local · ${selected}`));
      assert.ok(title >= 0 && heading > title && bottom > heading, lines.join("\n"));
      assert.ok(selectedLine > heading && selectedLine < bottom, lines.join("\n"));
      assert.ok(
        lines.every((line, i) => !line.includes("item-") || (i > heading && i < bottom)),
        lines.join("\n"),
      );
    };
    try {
      await view.flush();
      checkFrame("item-00");
      for (let i = 0; i < 25; i++) await act(async () => view.mockInput.pressArrow("down"));
      await view.flush();
      checkFrame("item-25");
      await act(async () => view.mockInput.typeText("item-3"));
      await view.flush();
      checkFrame("item-30");
      for (let i = 0; i < 9; i++) await act(async () => view.mockInput.pressArrow("down"));
      await view.flush();
      checkFrame("item-39");
    } finally {
      await view.dispose();
    }
  }
});

test("single chooser confirms or cancels local deletion and ignores remote deletion", async () => {
  const deleted = [];
  let closed = 0;
  const view = await testRender(
    React.createElement(SingleModelChooser, {
      models: [
        { provider: "local", id: "/model.gguf", name: "local model" },
        { provider: "openai", id: "remote", name: "remote model" },
      ],
      onClose: () => closed++,
      onSetSingleModel() {},
      onDeleteModel: (model) => deleted.push(model),
    }),
    { width: 100, height: 30 },
  );
  try {
    await view.flush();
    await act(async () => view.mockInput.pressKey("d", { ctrl: true }));
    await view.flush();
    assert.match(view.captureCharFrame(), /DELETE LOCAL MODEL/);
    await act(async () => view.mockInput.pressKey("escape"));
    assert.deepEqual(deleted, []);
    assert.equal(closed, 0);
    await act(async () => view.mockInput.pressKey("d", { ctrl: true }));
    await act(async () => view.mockInput.pressEnter());
    assert.deepEqual(deleted, ["/model.gguf"]);
    await act(async () => view.mockInput.pressArrow("down"));
    await act(async () => view.mockInput.pressKey("d", { ctrl: true }));
    await view.flush();
    assert.doesNotMatch(view.captureCharFrame(), /DELETE LOCAL MODEL/);
    assert.deepEqual(deleted, ["/model.gguf"]);
  } finally {
    await view.dispose();
  }
});

test("tier chooser excludes local models", async () => {
  const view = await testRender(
    React.createElement(ModelChooser, {
      models: [
        { provider: "local", id: "/secret.gguf", name: "secret-local" },
        { provider: "openai", id: "remote", name: "remote-model" },
      ],
      onClose() {},
      onSetClassifier() {},
      onSetTierWorker() {},
      onRefreshWorkerModels() {},
    }),
    { width: 120, height: 30 },
  );
  try {
    await view.flush();
    const frame = view.captureCharFrame();
    assert.doesNotMatch(frame, /secret-local|Ctrl\+D delete/);
    assert.match(frame, /remote-model/);
  } finally {
    await view.dispose();
  }
});

test("mode commands do not execute the other mode's commands", async () => {
  const events = [];
  for (const mode of ["single", "tiered"]) {
    const handler = createCommandHandler({
      mode,
      addMessage: (message) => events.push(message),
      openModelChooser: () => events.push("chooser"),
      openDownloadModal: () => events.push("download"),
      routeMessage: (text) => events.push(text),
    });
    await handler.handle(mode === "single" ? "/model" : "/route");
    await handler.handle(mode === "single" ? "/route" : "/download");
  }
  assert.equal(events.filter((event) => event === "chooser").length, 2);
  assert.equal(events.filter((event) => event?.severity === "warning").length, 2);
  assert.ok(!events.includes("download"));
});

test("shared welcome and provider views accept mode-specific presentation", async () => {
  const { Welcome } = await import("../src/components/Welcome.component.jsx");
  const { ProviderConnections } =
    await import("../src/components/ProviderConnections.component.jsx");
  const welcome = await testRender(
    React.createElement(Welcome, { commands: [["/model", "Choose a model"]] }),
    { width: 100, height: 30 },
  );
  try {
    await welcome.flush();
    assert.match(welcome.captureCharFrame(), /\/model/);
    assert.doesNotMatch(welcome.captureCharFrame(), /\/route/);
  } finally {
    await welcome.dispose();
  }
  const providers = await testRender(
    React.createElement(ProviderConnections, {
      modelCommand: "/model",
      providers: [{ id: "openai", name: "OpenAI", method: "apiKey" }],
      onClose() {},
      onAction() {},
    }),
    { width: 120, height: 30 },
  );
  try {
    await providers.flush();
    const frame = providers.captureCharFrame();
    assert.match(frame, /Select models in \/model/);
    assert.match(frame, /Refresh \/model/);
    assert.doesNotMatch(frame, /\/route/);
  } finally {
    await providers.dispose();
  }
});
