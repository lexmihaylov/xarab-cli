import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ModelChooser } from "../src/tiered/components/ModelChooser/index.tsx";

const models = [
  { provider: "local", id: "/local", name: "Local model" },
  { provider: "openai", id: "gpt-alpha", name: "Alpha" },
  { provider: "openrouter", id: "router-beta", name: "Beta" },
];

async function renderChooser(width = 140) {
  return testRender(
    React.createElement(ModelChooser, {
      models,
      tierWorkers: { 1: { provider: "openai", model: "gpt-alpha" } },
      classifier: { provider: "openai", model: "gpt-alpha" },
      onClose() {},
      onSetClassifier() {},
      onSetTierWorker() {},
      onRefreshWorkerModels() {},
    }),
    { width, height: 30 },
  );
}

test("tiered model chooser filters router and worker options and navigates choices", async () => {
  const view = await renderChooser();
  try {
    await view.flush();
    let frame = view.captureCharFrame();
    assert.match(frame, /OpenAI · Alpha/);
    assert.match(frame, /OpenRouter · Beta/);

    await act(async () => view.mockInput.typeText("router-beta"));
    await view.flush();
    frame = view.captureCharFrame();
    assert.match(frame, /OpenRouter · Beta/);

    await act(async () => view.mockInput.pressKey("tab"));
    await act(async () => view.mockInput.pressKey("right"));
    await view.flush();
    assert.match(view.captureCharFrame(), /03 TIER 1 WORKER/);
    await act(async () => view.mockInput.typeText("gpt-alpha"));
    await view.flush();
    frame = view.captureCharFrame();
    assert.match(frame, /OpenAI · Alpha/);
    await act(async () => view.mockInput.typeText("-not-found"));
    await view.flush();
    assert.match(view.captureCharFrame(), /No matching models/);
  } finally {
    await view.dispose();
  }
});

test("tiered chooser adapts visible panes to narrow and medium terminals", async () => {
  for (const [width, expected, absent] of [
    [70, /01 ROUTER MODEL/, /02 TIERS/],
    [100, /01 ROUTER MODEL/, /03 TIER 1 WORKER/],
  ]) {
    const view = await renderChooser(width);
    try {
      await view.flush();
      assert.match(view.captureCharFrame(), expected);
      assert.doesNotMatch(view.captureCharFrame(), absent);
      if (width === 70) {
        await act(async () => view.mockInput.pressKey("tab"));
        await view.flush();
        assert.match(view.captureCharFrame(), /Tier 1/);
      }
    } finally {
      await view.dispose();
    }
  }
});
