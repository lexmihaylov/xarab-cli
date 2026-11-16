import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIResponsesWorkerAdapter } from "../src/agent/worker/openai-responses-worker-adapter.js";
import { createOpenRouterWorkerAdapter } from "../src/agent/worker/openrouter-worker-adapter.js";
import { toolCallBatches } from "../src/agent/worker/tool-call-batches.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(provider, names, invalid = -1) {
  const requests = [];
  const fetchImpl = async (_, options) => {
    requests.push(JSON.parse(options.body));
    const calls = names.map((name, index) => ({
      name,
      id: String(index),
      arguments: index === invalid ? "{" : JSON.stringify({ index }),
    }));
    const event =
      provider === "OpenAI"
        ? {
            type: "response.completed",
            response: {
              output:
                requests.length === 1
                  ? calls.map((call) => ({
                      type: "function_call",
                      name: call.name,
                      call_id: call.id,
                      arguments: call.arguments,
                    }))
                  : [{ type: "message", content: [{ type: "output_text", text: "Done" }] }],
            },
          }
        : {
            choices: [
              {
                delta:
                  requests.length === 1
                    ? {
                        tool_calls: calls
                          .map((call, index) => ({
                            index,
                            id: call.id,
                            function: { name: call.name, arguments: call.arguments },
                          }))
                          .reverse(),
                      }
                    : { content: "Done" },
              },
            ],
          };
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
  };
  const adapter =
    provider === "OpenAI"
      ? createOpenAIResponsesWorkerAdapter({
          getCredentials: async () => ({ accessToken: "test" }),
          fetchImpl,
        })
      : createOpenRouterWorkerAdapter({ getApiKey: () => "test", fetchImpl });
  const outputs = () =>
    provider === "OpenAI"
      ? requests[1].input
          .filter((item) => item.type === "function_call_output")
          .map((item) => [item.call_id, item.output])
      : requests[1].messages
          .filter((item) => item.role === "tool")
          .map((item) => [item.tool_call_id, item.content]);
  return { adapter, requests, outputs };
}

const barriers = [
  "edit",
  "write",
  "insert_before",
  "insert_after",
  "run_command",
  "ask_questions",
  "skill",
  "generate_image",
  "edit_image",
  "analyze_image",
  "external_tool",
];
test("batch selection is explicit, bounded, and keeps tasks separate", () => {
  const reads = [
    "read_file",
    "list_files",
    "search_files",
    "search_content",
    "webfetch",
    "websearch",
  ];
  assert.deepEqual(
    [...toolCallBatches(reads, (name) => name)],
    [reads.slice(0, 4), reads.slice(4)],
  );
  for (const barrier of barriers) {
    const names = [
      "read_file",
      "list_files",
      barrier,
      "webfetch",
      "websearch",
      "task",
      "task",
      "read_file",
    ];
    assert.deepEqual(
      [...toolCallBatches(names, (name) => name)],
      [names.slice(0, 2), [barrier], names.slice(3, 5), ["task", "task"], ["read_file"]],
    );
  }
});

for (const provider of ["OpenAI", "OpenRouter"]) {
  test(`${provider}: read-only calls overlap, with ordered results and mutation/task barriers`, async () => {
    const names = [
      "read_file",
      "search_content",
      "edit",
      "list_files",
      "webfetch",
      "task",
      "task",
      "read_file",
    ];
    const { adapter, outputs } = fixture(provider, names);
    const gates = names.map(deferred);
    const started = names.map(deferred);
    const starts = [];
    const events = [];
    const handler = async ({ index }, { callId }) => {
      assert.equal(callId, String(index));
      starts.push(index);
      started[index].resolve();
      await gates[index].promise;
      return `result-${index}`;
    };
    const run = adapter.run({
      model: "test",
      input: [],
      onEvent: (event) => events.push(event),
      tools: Object.fromEntries(names.map((name) => [name, { handler }])),
    });
    await started[1].promise;
    assert.deepEqual(starts, [0, 1]);
    gates[1].resolve();
    await Promise.resolve();
    assert.deepEqual(starts, [0, 1]);
    gates[0].resolve();
    await started[2].promise;
    assert.deepEqual(starts, [0, 1, 2]);
    gates[2].resolve();
    await started[4].promise;
    assert.deepEqual(starts, [0, 1, 2, 3, 4]);
    gates[4].resolve();
    await Promise.resolve();
    assert.equal(starts.length, 5);
    gates[3].resolve();
    await started[6].promise;
    assert.deepEqual(starts, [0, 1, 2, 3, 4, 5, 6]);
    gates[6].resolve();
    gates[5].resolve();
    await started[7].promise;
    gates[7].resolve();
    await run;
    assert.deepEqual(
      outputs(),
      names.map((_, i) => [String(i), `result-${i}`]),
    );
    assert.equal(events.filter((event) => event.type === "tool_call").length, names.length);
    assert.equal(events.filter((event) => event.type === "tool_result").length, names.length);
  });

  test(`${provider}: read errors, invalid JSON and missing tools stay isolated`, async () => {
    const { adapter, outputs } = fixture(
      provider,
      ["read_file", "search_content", "list_files", "webfetch", "search_files"],
      2,
    );
    await adapter.run({
      model: "test",
      input: [],
      tools: {
        read_file: {
          handler: async () => {
            throw new Error("read failed");
          },
        },
        search_content: {
          handler: async () => ({ ok: false, output: "denied", errorCode: "DENIED" }),
        },
        list_files: { handler: async () => assert.fail("invalid arguments must not execute") },
        search_files: { handler: async () => "found" },
      },
    });
    const results = outputs();
    assert.deepEqual(
      results.map(([id]) => id),
      ["0", "1", "2", "3", "4"],
    );
    assert.equal(results[0][1], "Error: read failed");
    assert.equal(results[1][1], "denied");
    assert.match(results[2][1], /^Error:/);
    assert.equal(results[3][1], "Error: tool webfetch is unavailable.");
    assert.equal(results[4][1], "found");
  });

  for (const rejects of [false, true]) {
    test(`${provider}: abort during reads prevents barriers and follow-up requests (reject: ${rejects})`, async () => {
      const { adapter, requests } = fixture(provider, ["read_file", "search_files", "write"]);
      const controller = new AbortController();
      const gate = deferred();
      const started = deferred();
      let count = 0;
      const handler = async (_, { signal }) => {
        assert.equal(signal, controller.signal);
        if (++count === 2) started.resolve();
        await gate.promise;
        if (rejects) throw new Error("handler aborted");
        return "done";
      };
      const run = adapter.run({
        model: "test",
        input: [],
        signal: controller.signal,
        tools: {
          read_file: { handler },
          search_files: { handler },
          write: { handler: () => assert.fail("barrier executed") },
        },
      });
      await started.promise;
      controller.abort(new Error("cancelled by user"));
      gate.resolve();
      await assert.rejects(run, /cancel/i);
      assert.equal(requests.length, 1);
    });
  }

  test(`${provider}: handoff selection follows call order and stops later batches`, async () => {
    const { adapter, requests } = fixture(provider, ["read_file", "list_files", "write"]);
    const gate = deferred();
    const result = await adapter.run({
      model: "test",
      input: [],
      tools: {
        read_file: {
          handler: async () => {
            await gate.promise;
            return { ok: true, output: "", handoff: { first: true } };
          },
        },
        list_files: {
          handler: async () => {
            gate.resolve();
            return { ok: true, output: "", handoff: { first: false } };
          },
        },
        write: { handler: () => assert.fail("barrier executed") },
      },
    });
    assert.deepEqual(result, { handoff: { first: true } });
    assert.equal(requests.length, 1);
  });
}
