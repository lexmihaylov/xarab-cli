import assert from "node:assert/strict";
import test from "node:test";
import { createCommandHandler } from "../src/agent/assistant-command-handler.js";

function setup(
  mode,
  route = {
    classification: { tier: 2, confidence: 0.8, rationale: "test" },
    worker: { configured: true, model: "worker" },
  },
) {
  const events = [];
  const handler = createCommandHandler({
    mode,
    addMessage: (message) => (events.push(message), message),
    openModelChooser: () => events.push("chooser"),
    openDownloadModal: (query) => events.push(`download:${query}`),
    openProviderModal: () => events.push("connect"),
    routeMessage: (text) => events.push(`direct:${text}`),
    classifyForRouting: async () => route,
    runWorker: (text, options) => events.push({ text, ...options }),
    notify: () => events.push("notify"),
  });
  return { events, handle: handler.handle };
}

test("mode-specific commands, help and dispatch", async () => {
  for (const mode of ["single", "tiered"]) {
    const { events, handle } = setup(mode);
    await handle("/help");
    assert.match(events[0].message, mode === "single" ? /\/model/ : /\/route/);
    await handle(mode === "single" ? "/model" : "/route");
    await handle("/download example");
    await handle("/connect");
    await handle("hello");
    assert.ok(events.includes("chooser"));
    assert.ok(events.includes("connect"));
    if (mode === "tiered") assert.ok(events.some((e) => e.severity === "warning"));
    else assert.ok(events.includes("download:example"));
    if (mode === "single") assert.ok(events.includes("direct:hello"));
    else
      assert.ok(
        events.some(
          (e) =>
            e.text === "hello" && e.tier === 2 && e.userMessage.classification.status === "done",
        ),
      );
  }
});

test("command handler requires an explicit valid mode or command policy", () => {
  assert.throws(() => setup(undefined), /explicit valid application mode/);
  assert.throws(() => setup("mixed"), /explicit valid application mode/);
  assert.throws(() => createCommandHandler({ commandPolicy: {} }), /valid command policy/);
});

test("tiered routing cancellation and invalid worker remain enforced", async () => {
  for (const [route, status, error] of [
    [{ cancelled: true }, "cancelled", null],
    [null, "error", null],
    [{ classification: { tier: 1 } }, "error", /No worker/],
    [
      { classification: { tier: 1 }, worker: { configured: false } },
      "error",
      /configuration is invalid/,
    ],
  ]) {
    const { events, handle } = setup("tiered", route);
    if (error) await assert.rejects(handle("hello"), error);
    else await handle("hello");
    assert.equal(events[0].classification.status, status);
    assert.ok(!events.some((e) => e.text === "hello"));
  }
});
