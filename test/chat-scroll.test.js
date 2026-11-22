import test from "node:test";
import assert from "node:assert/strict";
import { chatScrollAcceleration } from "../src/ChatShell.component.jsx";

test("chat wheel scroll acceleration is 10x", () => {
  assert.equal(chatScrollAcceleration.tick(), 10);
  assert.equal(chatScrollAcceleration.reset(), undefined);
});
