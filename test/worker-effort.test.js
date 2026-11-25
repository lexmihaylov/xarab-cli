import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workerVariants, effortLabel } from "../src/utils/worker-effort.js";
import { createTieredConfigStore } from "../src/tiered/config-store.js";
import { buildWorkerHistory } from "../src/agent/worker/worker.js";
import { restoreMessages } from "../src/agent/session-history.js";

test("worker variants use advertised efforts only and retain explicit provider default", () => {
  assert.deepEqual(
    workerVariants({
      provider: "openai",
      id: "m",
      supported_reasoning_levels: [{ effort: "custom" }],
    }),
    [
      { provider: "openai", model: "m", effort: "default" },
      { provider: "openai", model: "m", effort: "custom" },
    ],
  );
  assert.equal(workerVariants({ provider: "openrouter", id: "m" }).length, 1);
  assert.equal(
    workerVariants({
      provider: "openrouter",
      id: "m",
      reasoning: { supported_efforts: null, mandatory: true },
    }).some((v) => v.effort === "none"),
    false,
  );
  assert.equal(effortLabel({ provider: "openai" }), "low (legacy)");
});

test("effort survives separate routing config save/load, without changing classifier", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xarab-effort-"));
  try {
    const args = [path.join(dir, "config.json"), path.join(dir, "routing.json")];
    const store = createTieredConfigStore(...args);
    await store.setTierWorker(1, { provider: "openai", model: "m", effort: "default" });
    await store.setTierWorker(2, { provider: "openai", model: "m", effort: "high" });
    await store.setClassifier({ provider: "openai", model: "m", effort: "high" });
    const loaded = createTieredConfigStore(...args);
    await loaded.load();
    assert.equal(loaded.getTierWorker(1).effort, "default");
    assert.equal(loaded.getTierWorker(2).effort, "high");
    assert.equal(loaded.getClassifier().effort, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenRouter opaque history survives session restore and stays provider-specific", () => {
  const raw = [
    {
      role: "assistant",
      content: "answer",
      reasoning_details: [
        {
          type: "reasoning.encrypted",
          data: "opaque",
          signature: "signed",
          extra: { future: true },
        },
      ],
    },
  ];
  const restored = restoreMessages([
    {
      type: "agent",
      message: "answer",
      parts: [{ type: "text", text: "answer" }],
      openrouterMessages: raw,
    },
  ]);
  assert.deepEqual(buildWorkerHistory(restored, "next", "openrouter"), [
    ...raw,
    { role: "user", content: "next" },
  ]);
  assert.deepEqual(buildWorkerHistory(restored, undefined, "openai"), [
    { role: "assistant", content: "answer" },
  ]);
});

test("restored intermediate OpenRouter snapshot retains subsequent partial text once", () => {
  const raw = [
    {
      role: "assistant",
      content: "before",
      tool_calls: [{ id: "c", type: "function", function: { name: "read", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "c", content: "result" },
  ];
  const restored = restoreMessages([
    {
      type: "agent",
      message: "beforepartial",
      parts: [
        { type: "text", text: "before" },
        { type: "tool", callId: "c" },
        { type: "text", text: "partial" },
      ],
      openrouterMessages: raw,
      openrouterTextLength: 6,
    },
  ]);
  assert.deepEqual(buildWorkerHistory(restored, "next", "openrouter"), [
    ...raw,
    { role: "assistant", content: "partial" },
    { role: "user", content: "next" },
  ]);
});

test("model discovery preserves actual provider effort metadata", async () => {
  const { createOpenAIModelManager } = await import("../src/agent/openai-model-manager.js");
  const { createOpenRouterModelManager } = await import("../src/agent/openrouter-model-manager.js");
  const levels = [
    { effort: "low", description: "Fast" },
    { effort: "future", description: "Future" },
  ];
  const openai = createOpenAIModelManager({
    getCredentials: async () => ({}),
    fetchImpl: async () =>
      Response.json({
        models: [
          { slug: "m", supported_reasoning_levels: levels, default_reasoning_level: "future" },
        ],
      }),
  });
  const [a] = await openai.listModels();
  assert.deepEqual(a.supported_reasoning_levels, levels);
  assert.equal(a.default_reasoning_level, "future");
  const reasoning = {
    supported_efforts: null,
    default_effort: "medium",
    default_enabled: true,
    mandatory: true,
    supports_max_tokens: true,
  };
  const router = createOpenRouterModelManager({
    getApiKey: () => "key",
    fetchImpl: async () =>
      Response.json({
        data: [{ id: "m", architecture: { output_modalities: ["text"] }, reasoning }],
      }),
  });
  const [b] = await router.listModels();
  assert.deepEqual(b.reasoning, reasoning);
});

test("remote context metadata is discovered and persisted with tier assignments", async () => {
  const { createOpenAIModelManager } = await import("../src/agent/openai-model-manager.js");
  const { createOpenRouterModelManager } = await import("../src/agent/openrouter-model-manager.js");
  const ai = createOpenAIModelManager({
    getCredentials: async () => ({}),
    fetchImpl: async () => Response.json({ models: [{ slug: "a", context_window: 128000 }] }),
  });
  const router = createOpenRouterModelManager({
    getApiKey: () => "key",
    fetchImpl: async () =>
      Response.json({
        data: [{ id: "b", context_length: 64000, architecture: { output_modalities: ["text"] } }],
      }),
  });
  assert.equal((await ai.listModels())[0].contextWindow, 128000);
  assert.equal((await router.listModels())[0].contextWindow, 64000);
  const dir = await mkdtemp(path.join(os.tmpdir(), "xarab-context-"));
  try {
    const args = [path.join(dir, "config.json"), path.join(dir, "routing.json")];
    const store = createTieredConfigStore(...args);
    await store.setTierWorker(1, { provider: "openrouter", model: "b", contextWindow: 64000 });
    const loaded = createTieredConfigStore(...args);
    await loaded.load();
    assert.equal(loaded.getTierWorker(1).contextWindow, 64000);
    const { createSingleConfigStore } = await import("../src/single/config-store.js");
    const singlePath = path.join(dir, "single.json");
    for (const discovered of [...(await ai.listModels()), ...(await router.listModels())]) {
      const configured = createSingleConfigStore(singlePath);
      await configured.setSingleModel(workerVariants(discovered)[0]);
      const reloaded = createSingleConfigStore(singlePath);
      await reloaded.load();
      assert.equal(reloaded.getSingleModel().contextWindow, discovered.contextWindow);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
