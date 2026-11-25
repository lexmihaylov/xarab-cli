import test from "node:test";
import assert from "node:assert/strict";
import {
  ContextBudgetError,
  estimateRequestTokens,
} from "../src/agent/worker/local-request-budget.js";

test("estimates complete serialized requests in UTF-8 bytes", () => {
  const request = { input: "é" };
  assert.equal(estimateRequestTokens(request), Buffer.byteLength(JSON.stringify(request), "utf8"));
  assert.equal(estimateRequestTokens(request), 14);
});

test("budget errors distinguish requests from tool continuations", () => {
  const initial = new ContextBudgetError("local", "model", 101, 100);
  assert.match(initial.message, /Request for local model model exceeds/);
  const continuation = new ContextBudgetError("local", "model", 101, 100, {
    continuation: true,
  });
  assert.match(continuation.message, /Completed tools were not rerun/);
});
