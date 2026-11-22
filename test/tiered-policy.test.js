import assert from "node:assert/strict";
import test from "node:test";
import { createTieredAppPolicy } from "../src/tiered/app-policy.js";
import { createTieredChooserActions } from "../src/tiered/chooser-actions.js";
import { createTieredRouting } from "../src/tiered/routing.js";

test("tiered policy is remote-only even if legacy options are supplied", () => {
  assert.equal(createTieredAppPolicy({ remoteOnly: false }).remoteOnly, true);
});

test("tiered routing rejects migrated local classifiers without an opt-in flag", () => {
  const routing = createTieredRouting({
    configStore: { getClassifier: () => ({ provider: "local", model: "old.gguf" }) },
  });
  assert.throws(() => routing.classifyForRouting("hello"), /Local classifiers are unavailable/);
});

test("tiered chooser rejects local assignments without an opt-in flag", async () => {
  let modal = {};
  let writes = 0;
  const actions = createTieredChooserActions({
    configStore: {
      setClassifier: async () => writes++,
      setTierWorker: async () => writes++,
    },
    getModelModal: () => modal,
    setModelModal: (value) => (modal = value),
    notify() {},
    routing: { getClassifier() {} },
  });
  await actions.setRouterClassifier("old.gguf");
  assert.match(modal.error, /remote classifier/);
  await actions.setRouterTierWorker(1, { provider: "local", model: "old.gguf" });
  assert.match(modal.error, /remote worker/);
  assert.equal(writes, 0);
});
