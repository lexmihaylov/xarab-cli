import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ProviderConnections } from "../src/components/ProviderConnections.component.jsx";
import { ModelChooser } from "../src/tiered/components/ModelChooser/index.tsx";
import { StatusBar } from "../src/components/StatusBar.component.jsx";

async function render(element, options = { width: 120, height: 30 }) {
  const view = await testRender(element, options);
  await view.flush();
  return view;
}

test("model chooser applies the selected router and worker model", async () => {
  const classifiers = [];
  const workers = [];
  const view = await render(
    React.createElement(ModelChooser, {
      models: [
        { provider: "local", id: "/models/router.gguf", name: "router.gguf" },
        { provider: "openai", id: "gpt-test", name: "Test worker" },
      ],
      modelSettings: {},
      classifierModel: null,
      tierWorkers: {},
      onClose() {},
      onSetClassifier: (model) => classifiers.push(model),
      onSetTierWorker: (...args) => workers.push(args),
      onRefreshWorkerModels() {},
    }),
  );
  try {
    assert.match(view.captureCharFrame(), /ROUTING & MODEL ASSIGNMENTS/);
    await act(async () => view.mockInput.pressArrow("down"));
    await view.flush();
    await act(async () => view.mockInput.pressEnter());
    await view.flush();
    await act(async () => view.mockInput.pressEnter());
    await view.flush();
    await act(async () => view.mockInput.pressEnter());
    assert.deepEqual(classifiers, [{ provider: "openai", model: "gpt-test" }]);
    assert.equal(workers[0][1].provider, "openai");
  } finally {
    await view.dispose();
  }
});

test("model chooser keeps the active pane and scrolled selections visible", async () => {
  const models = Array.from({ length: 24 }, (_, index) => ({
    provider: "openrouter",
    id: `model-${String(index).padStart(2, "0")}`,
    name: `Model ${String(index).padStart(2, "0")}`,
  }));
  const view = await render(
    React.createElement(ModelChooser, {
      models,
      classifier: { provider: "openrouter", model: "model-20" },
      tierWorkers: { 1: { provider: "openrouter", model: "model-20", effort: "default" } },
      onClose() {},
      onSetClassifier() {},
      onSetTierWorker() {},
      onRefreshWorkerModels() {},
    }),
    { width: 110, height: 18 },
  );
  const key = async (name) => {
    await act(async () =>
      name === "tab" ? view.mockInput.pressTab() : view.mockInput.pressArrow(name),
    );
    await view.flush();
    await view.flush();
  };
  try {
    await view.flush();
    await view.flush();
    assert.match(view.captureCharFrame(), /› OpenRouter · Model 20/);
    await key("down");
    assert.match(view.captureCharFrame(), /› OpenRouter · Model 21/);
    await key("tab");
    await key("tab");
    assert.match(view.captureCharFrame(), /03 TIER 1 WORKER/);
    assert.match(view.captureCharFrame(), /› OpenRouter · Model 20/);
    await key("down");
    assert.match(view.captureCharFrame(), /› OpenRouter · Model 21/);
  } finally {
    await view.dispose();
  }
});

test("model chooser scrolls tier selection in a short terminal", async () => {
  const view = await render(
    React.createElement(ModelChooser, {
      onClose() {},
      onSetClassifier() {},
      onSetTierWorker() {},
      onRefreshWorkerModels() {},
    }),
    { width: 80, height: 17 },
  );
  try {
    await act(async () => view.mockInput.pressTab());
    await view.flush();
    await act(async () => view.mockInput.pressArrow("down"));
    await view.flush();
    await act(async () => view.mockInput.pressArrow("down"));
    await view.flush();
    await view.flush();
    await view.flush();
    assert.match(view.captureCharFrame(), /› Tier 3/);
  } finally {
    await view.dispose();
  }
});

test("provider dialog starts sign-in and offers redirect input", async () => {
  const actions = [];
  const props = {
    providers: [{ id: "openai", name: "OpenAI" }],
    statuses: { openai: "Not connected" },
    onClose() {},
    onAction: (...args) => actions.push(args),
  };
  const view = await render(React.createElement(ProviderConnections, props));
  try {
    assert.match(view.captureCharFrame(), /PROVIDER CONNECTIONS/);
    await act(async () => view.mockInput.pressEnter());
    assert.deepEqual(actions, [["openai", "connect"]]);
    const pendingView = await render(
      React.createElement(ProviderConnections, {
        ...props,
        pending: { id: "openai", url: "https://example.com/login", copied: true },
      }),
    );
    try {
      assert.match(pendingView.captureCharFrame(), /Paste redirect URL/);
      assert.match(pendingView.captureCharFrame(), /Sign-in URL copied/);
    } finally {
      await pendingView.dispose();
    }
  } finally {
    await view.dispose();
  }
});

test("Tavily panel explains its saved key and environment override", async () => {
  const actions = [];
  const view = await render(
    React.createElement(ProviderConnections, {
      providers: [{ id: "tavily", name: "Tavily Search", method: "apiKey" }],
      statuses: { tavily: "No API key saved" },
      onClose() {},
      onAction: (...args) => actions.push(args),
    }),
  );
  try {
    await act(async () => view.mockInput.pressKey("tab"));
    await view.flush();
    const frame = view.captureCharFrame();
    assert.match(frame, /TAVILY_API_KEY environment variable takes precedence/);
    assert.match(frame, /Key entry is visible/);
  } finally {
    await view.dispose();
  }
});

test("OpenRouter panel directs users to refresh routing models", async () => {
  const view = await render(
    React.createElement(ProviderConnections, {
      providers: [{ id: "openrouter", name: "OpenRouter", method: "apiKey" }],
      statuses: { openrouter: "No API key saved" },
      onClose() {},
      onAction() {},
    }),
  );
  try {
    assert.match(view.captureCharFrame(), /Refresh \/route to verify model access/);
    assert.match(view.captureCharFrame(), /Key entry is visible/);
  } finally {
    await view.dispose();
  }
});

test("status bar keeps session title when persistence errors occur", async () => {
  const view = await render(
    React.createElement(StatusBar, {
      status: "Ready",
      sessionTitle: "A saved conversation",
      sessionError: "Session save failed",
    }),
    { width: 80, height: 3 },
  );
  try {
    const frame = view.captureCharFrame();
    assert.match(frame, /A saved conversation/);
    assert.doesNotMatch(frame, /Session save failed|Ready/);
  } finally {
    await view.dispose();
  }
});
