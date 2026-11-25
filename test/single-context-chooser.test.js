import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { SingleModelChooser } from "../src/single/SingleModelChooser.component.jsx";
import { createSingleChooserActions } from "../src/single/chooser-actions.js";

test("context action saves, resets, and reports busy or persistence errors in chooser", async () => {
  let modal = { mode: "chooser", modelSettings: { "/a": { name: "A" } } };
  let busy = false;
  let fail = false;
  const calls = [];
  const actions = createSingleChooserActions({
    configStore: {
      async setModelContextSize(...args) {
        calls.push(args);
        if (fail) throw new Error("disk error");
      },
    },
    getModelModal: () => modal,
    setModelModal: (value) => {
      modal = value;
    },
    isBusy: () => busy,
    notify() {},
  });
  assert.equal(await actions.setModelContextSize("/a", 32768), true);
  assert.deepEqual(modal.modelSettings["/a"], { name: "A", contextSize: 32768 });
  assert.equal(await actions.setModelContextSize("/a", undefined), true);
  assert.deepEqual(modal.modelSettings["/a"], { name: "A" });
  busy = true;
  assert.equal(await actions.setModelContextSize("/a", 1), false);
  assert.match(modal.error, /current work/);
  assert.equal(calls.length, 2);
  busy = false;
  fail = true;
  assert.equal(await actions.setModelContextSize("/a", 1), false);
  assert.match(modal.error, /disk error/);
});

test("local context editor validates, cancels, saves and excludes remote models", async () => {
  const calls = [];
  const view = await testRender(
    React.createElement(SingleModelChooser, {
      models: [
        { provider: "local", id: "/a", name: "A" },
        { provider: "openai", id: "b", name: "B" },
      ],
      modelSettings: { "/a": { contextSize: 4096 } },
      onClose() {},
      onSetSingleModel() {},
      onSetModelContextSize: async (...args) => {
        calls.push(args);
        return true;
      },
    }),
    { width: 100, height: 30 },
  );
  try {
    await view.flush();
    assert.match(view.captureCharFrame(), /Context size: 4096/);
    await act(async () => view.mockInput.pressKey("g", { ctrl: true }));
    await view.flush();
    assert.match(view.captureCharFrame(), /LOCAL CONTEXT SIZE/);
    await act(async () => view.mockInput.pressEscape());
    await view.flush();
    assert.deepEqual(calls, []);
    await act(async () => view.mockInput.pressKey("g", { ctrl: true }));
    await view.flush();
    assert.match(view.captureCharFrame(), /LOCAL CONTEXT SIZE/);
    await act(async () => view.mockInput.typeText("x"));
    await act(async () => view.mockInput.pressEnter());
    await view.flush();
    assert.match(view.captureCharFrame(), /positive safe integer/);
    assert.deepEqual(calls, []);
    await act(async () => view.mockInput.pressBackspace());
    await act(async () => view.mockInput.pressEnter());
    await view.flush();
    assert.deepEqual(calls, [["/a", 4096]], view.captureCharFrame());
    await act(async () => view.mockInput.pressKey("g", { ctrl: true }));
    await view.flush();
    for (let i = 0; i < 4; i++) await act(async () => view.mockInput.pressBackspace());
    await act(async () => view.mockInput.pressEnter());
    await view.flush();
    assert.deepEqual(calls, [
      ["/a", 4096],
      ["/a", undefined],
    ]);
    await act(async () => view.mockInput.pressArrow("down"));
    await act(async () => view.mockInput.pressKey("g", { ctrl: true }));
    await view.flush();
    assert.doesNotMatch(view.captureCharFrame(), /LOCAL CONTEXT SIZE/);
  } finally {
    await view.dispose();
  }
});
