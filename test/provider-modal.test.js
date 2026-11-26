import test from "node:test";
import assert from "node:assert/strict";
import { createProviderModal } from "../src/agent/controller/provider-modal.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("late action status cannot update a closed or reopened provider modal", async () => {
  for (const reopen of [false, true]) {
    const pending = deferred();
    let calls = 0;
    let notifications = 0;
    const provider = {
      id: "example", name: "Example", method: "apiKey",
      status: () => ++calls === 2 ? pending.promise : Promise.resolve("current"),
      complete: async () => ({}),
    };
    const modal = createProviderModal({
      providers: [provider], chooserCommand: "/models",
      closeModelModalForProvider: () => {}, notify: () => { notifications++; },
    });
    await modal.openProviderModal();
    const action = modal.providerAction("example", "complete", "key");
    await Promise.resolve();
    assert.equal(calls, 2);
    modal.closeProviderModal();
    if (reopen) {
      await modal.openProviderModal();
    }
    const state = modal.getState();
    const count = notifications;
    pending.resolve("stale");
    await action;
    assert.equal(modal.getState(), state);
    assert.equal(notifications, count);
  }
});

test("status errors appear in the provider modal", async () => {
  const modal = createProviderModal({
    providers: [{
      id: "example",
      name: "Example",
      method: "apiKey",
      status: async () => { throw new Error("offline"); },
    }],
    chooserCommand: "/models",
    closeModelModalForProvider: () => {},
    notify: () => {},
  });

  await modal.openProviderModal();
  assert.equal(modal.getState().statuses.example, "Status unavailable: offline");
  assert.equal(modal.getState().busy, false);
});
