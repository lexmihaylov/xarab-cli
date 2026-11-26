import assert from "node:assert/strict";
import test from "node:test";
import React, { act, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { agentTimelineEntries } from "../src/ChatShell.component.jsx";
import { App } from "../src/single/components/App.component.jsx";
import { AssistantMessage } from "../src/components/AssistantMessage.component.jsx";
import { ToolMessage } from "../src/components/ToolMessage.component.jsx";
import { Welcome } from "../src/components/Welcome.component.jsx";

async function renderMessage(props) {
  const view = await testRender(React.createElement(AssistantMessage, props), {
    width: 60,
    height: 12,
  });
  await act(async () => view.flush());
  return view;
}

test("splits agent timeline parts and streams only its final text entry", () => {
  const entries = agentTimelineEntries(
    {
      type: "agent",
      parts: [
        { type: "text", text: "Before tool" },
        { type: "tool", toolName: "read_file" },
        { type: "text", text: "After" },
        { type: "text", text: " tool" },
      ],
    },
    true,
  );

  assert.deepEqual(entries, [
    { type: "text", key: "text-0", responseText: "Before tool", generating: false },
    {
      type: "tool",
      key: "tool-1",
      part: { type: "tool", toolName: "read_file" },
    },
    { type: "text", key: "text-1", responseText: "After tool", generating: true },
  ]);
});

test("does not render a successful file listing output body", async () => {
  const view = await testRender(
    React.createElement(ToolMessage, {
      part: {
        toolName: "list_files",
        status: "complete",
        title: "Listing files",
        summary: "Files in .:\nsrc/secret-file.js",
      },
    }),
    { width: 60, height: 12 },
  );
  await act(async () => view.flush());
  try {
    const frame = view.captureCharFrame();
    assert.match(frame, /Listing files/);
    assert.doesNotMatch(frame, /Files in|secret-file/);
  } finally {
    await act(async () => view.dispose());
  }
});

test("renders fenced agent response content as markdown", async () => {
  const view = await renderMessage({
    message: { message: "```text\nhello\n```" },
  });
  try {
    const frame = view.captureCharFrame();
    assert.match(frame, /hello/);
    assert.doesNotMatch(frame, /```text|```/);
  } finally {
    await act(async () => view.dispose());
  }
});

test("renders multiple fenced code blocks without exposing markdown markers", async () => {
  const content = [
    "# Markdown Rendering Test",
    "",
    "```sh",
    "npm config delete dns --location=user",
    "```",
    "",
    "```js",
    "function greet(name) {",
    "  return `Hello, ${name}!`;",
    "}",
    "",
    'console.log(greet("Xarab"));',
    "```",
  ].join("\n");
  const view = await testRender(
    React.createElement(AssistantMessage, { message: { message: content } }),
    { width: 80, height: 24 },
  );
  await act(async () => view.flush());
  try {
    const frame = view.captureCharFrame();
    assert.match(frame, /npm config delete dns --location=user/);
    assert.match(frame, /function greet\(name\)/);
    assert.match(frame, /return `Hello, \$\{name\}!`;/);
    assert.doesNotMatch(frame, /```(?:sh|js)?/);
  } finally {
    await act(async () => view.dispose());
  }
});

test("Ctrl+C closes the renderer without invoking an interrupt handler", async () => {
  let interrupts = 0;
  const view = await testRender(
    React.createElement(App, {
      state: {
        messages: [],
        generating: false,
        sessionDraft: { value: "", cursor: 0 },
        status: "",
      },
      onSubmit() {},
      onDraftChange() {},
      onInterrupt() {
        interrupts++;
      },
    }),
    { width: 80, height: 24 },
  );
  try {
    await act(async () => view.flush());
    await act(async () => view.mockInput.pressKey("c", { ctrl: true }));
    await view.renderer.closed;
    assert.equal(interrupts, 0);
  } finally {
    await act(async () => view.dispose());
  }
});

test("renders assistant markdown incrementally and finalizes the completed segment", async () => {
  let updateState;
  const initialText = "# Example\n\nFirst **bold** paragraph.\n\n";
  const streamedText = `${initialText}A second *unfinished`;
  const completedText = `${initialText}A second *unfinished* paragraph.`;

  function Harness() {
    const [state, setState] = useState({
      messages: [
        { type: "agent", message: initialText, parts: [{ type: "text", text: initialText }] },
      ],
      generating: true,
      sessionDraft: { value: "", cursor: 0 },
      status: "",
    });
    updateState = setState;
    return React.createElement(App, {
      state,
      onSubmit() {},
      onStopGeneration() {},
      onDraftChange() {},
    });
  }

  function updateResponse(text, generating) {
    act(() => {
      updateState((state) => ({
        ...state,
        generating,
        messages: [
          {
            ...state.messages[0],
            message: text,
            parts: [{ type: "text", text }],
          },
        ],
      }));
    });
  }

  const view = await testRender(React.createElement(Harness), { width: 80, height: 24 });
  await act(async () => view.flush());
  try {
    assert.match(view.captureCharFrame(), /Example/);
    assert.doesNotMatch(view.captureCharFrame(), /# Example/);
    assert.match(view.captureCharFrame(), /First bold paragraph\./);

    await act(async () => updateResponse(streamedText, true));
    await act(async () => view.flush());
    let frame = view.captureCharFrame();
    assert.match(frame, /A second \*unfinished/);

    await act(async () => updateResponse(completedText, false));
    await act(async () => view.flush());
    frame = view.captureCharFrame();
    assert.match(frame, /A second unfinished paragraph\./);
    assert.doesNotMatch(frame, /\*unfinished\*/);
  } finally {
    await act(async () => view.dispose());
  }
});

test("top-level streaming markdown conceals a heading while the following paragraph grows", async () => {
  let update;
  function Harness() {
    const [content, setContent] = useState("# Heading\n\n");
    update = setContent;
    return React.createElement("markdown", {
      content,
      streaming: true,
      conceal: true,
      internalBlockMode: "top-level",
    });
  }
  const view = await testRender(React.createElement(Harness), { width: 80, height: 12 });
  try {
    for (const content of ["# Heading\n\n", "# Heading\n\nA", "# Heading\n\nA paragraph grows."]) {
      await act(async () => update(content));
      await act(async () => view.renderOnce());
      const immediate = view.captureCharFrame();
      await act(async () => view.flush());
      const settled = view.captureCharFrame();
      for (const frame of [immediate, settled]) {
        assert.match(frame, /Heading/);
        assert.doesNotMatch(frame, /# Heading/);
      }
    }
  } finally {
    await act(async () => view.dispose());
  }
});

test("renders the generating state without response text", async () => {
  const view = await renderMessage({ message: { message: "" }, generating: true });
  try {
    assert.match(view.captureCharFrame(), /Generating…/);
  } finally {
    await act(async () => view.dispose());
  }
});

test("renders the pixel wordmark and help section", async () => {
  const view = await testRender(React.createElement(Welcome), { width: 80, height: 24 });
  await act(async () => view.flush());
  try {
    const frame = view.captureCharFrame();
    assert.match(frame, /██[ ▄▀█]*██/);
    assert.match(frame, /[▄▀]/);
    assert.doesNotMatch(frame, /HELP/);
    for (const command of [
      "/connect",
      "/route",
      "/download",
      "/sessions",
      "/clear",
      "/new",
      "!command",
    ]) {
      assert.ok(frame.includes(command), command);
    }
    assert.doesNotMatch(frame, /\/help/);
    assert.match(frame, /\/sessions/);
    assert.match(frame, /!command/);
  } finally {
    await act(async () => view.dispose());
  }
});

test("keeps welcome guidance visible in a compact terminal", async () => {
  const view = await testRender(React.createElement(Welcome), { width: 36, height: 12 });
  await act(async () => view.flush());
  try {
    const frame = view.captureCharFrame();
    assert.match(frame, /XARAB/);
    assert.match(frame, /\/connect/);
    assert.match(frame, /\/route/);
  } finally {
    await act(async () => view.dispose());
  }
});
test("fits welcome guidance above the composer at different terminal sizes", async () => {
  for (const [width, height] of [
    [120, 40],
    [80, 24],
    [60, 18],
    [40, 24],
    [36, 12],
  ]) {
    const view = await testRender(
      React.createElement(
        "box",
        { width, height: height - 5, overflow: "hidden" },
        React.createElement(Welcome),
      ),
      { width, height },
    );
    await act(async () => view.flush());
    try {
      const frame = view.captureCharFrame();
      assert.match(frame, /\/connect/, `${width}x${height} quick action`);
      assert.match(frame, /\/route/, `${width}x${height} routing`);
      if (height >= 24) assert.match(frame, /!command/, `${width}x${height} full help`);
    } finally {
      await act(async () => view.dispose());
    }
  }
});
