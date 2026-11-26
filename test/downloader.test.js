import React, { act } from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { testRender } from "@opentui/react/test-utils";
import { ModelDownloader } from "../src/single/components/ModelDownloader/index.tsx";

const downloads = Array.from({ length: 20 }, (_, index) => ({
  name: `publisher/model-${index + 1}`,
  title: `Model ${index + 1}`,
  files: Array.from({ length: 30 }, (_, file) => ({
    fileName: `q${file + 1}.gguf`,
    uri: `test:${index}/${file}`,
    size: 2_000_000_000,
  })),
}));

test("downloader keeps headers and table columns separate and scrolls selected models", async (t) => {
  // Keep metadata pending: this test exercises local layout, not Hugging Face.
  t.mock.method(
    globalThis,
    "fetch",
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  const selectedDownloads = [];
  const view = await testRender(
    React.createElement(ModelDownloader, {
      downloads,
      onClose() {},
      onSearch() {},
      onDownloadSelected(...args) {
        selectedDownloads.push(args);
      },
    }),
    { width: 140, height: 30 },
  );
  try {
    await view.flush();
    const frame = view.captureCharFrame();
    assert.match(frame, /Model:.*1\/20.*Quantization:.*1\/30/);
    assert.match(frame, /File name.*File size/);
    assert.match(frame, /q1.gguf.*2.0 GB/);
    await act(async () => view.mockInput.pressTab());
    await view.flush();
    for (let i = 0; i < 19; i++) {
      await act(async () => view.mockInput.pressArrow("down"));
      await view.flush();
    }
    assert.match(view.captureCharFrame(), /Model:.*20\/20/);
    assert.match(view.captureCharFrame(), /Model 20/);
    await act(async () => view.mockInput.pressArrow("right"));
    for (let i = 0; i < 29; i++) {
      await act(async () => view.mockInput.pressArrow("down"));
      await view.flush();
    }
    assert.match(view.captureCharFrame(), /Quantization:.*30\/30/);
    assert.match(view.captureCharFrame(), /q30.gguf.*2.0 GB/);
    await act(async () => view.mockInput.pressEnter());
    assert.deepEqual(selectedDownloads, [["test:19/29", "q30.gguf"]]);
    await act(async () => view.resize(70, 24));
    await view.flush();
    assert.match(view.captureCharFrame(), /Quantization:.*30\/30/);
    assert.doesNotMatch(view.captureCharFrame(), /Model:/);
    await act(async () => view.mockInput.pressArrow("left"));
    await view.flush();
    assert.match(view.captureCharFrame(), /Model:.*20\/20/);
    assert.doesNotMatch(view.captureCharFrame(), /Quantization:/);
  } finally {
    await view.dispose();
  }
});

for (const canceling of [false, true]) {
  test(`download overlay isolates browser input${canceling ? " while canceling" : ""}`, async (t) => {
    t.mock.method(
      globalThis,
      "fetch",
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const calls = { close: 0, search: 0, download: 0, cancel: 0 };
    const view = await testRender(
      React.createElement(ModelDownloader, {
        downloads,
        downloading: "test:0/0",
        downloadFileName: "q1.gguf",
        canceling,
        onClose: () => calls.close++,
        onSearch: () => calls.search++,
        onDownloadSelected: () => calls.download++,
        onCancelDownload: () => calls.cancel++,
      }),
      { width: 140, height: 30 },
    );
    try {
      await view.flush();
      assert.match(view.captureCharFrame(), canceling ? /CANCELING DOWNLOAD/ : /DOWNLOADING MODEL/);
      await act(async () => {
        view.mockInput.pressTab();
        view.mockInput.pressArrow("down");
        view.mockInput.pressArrow("right");
        view.mockInput.pressEnter();
        view.mockInput.pressEscape();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      await view.flush();
      assert.deepEqual(calls, { close: 0, search: 0, download: 0, cancel: canceling ? 0 : 1 });
    } finally {
      await view.dispose();
    }
  });
}

test("narrow browser switches visible panes and Escape returns to search before closing", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  let closed = 0;
  const view = await testRender(
    React.createElement(ModelDownloader, {
      downloads,
      onClose: () => closed++,
      onSearch() {},
      onDownloadSelected() {},
    }),
    { width: 70, height: 24 },
  );
  try {
    await view.flush();
    assert.match(view.captureCharFrame(), /Model:.*1\/20/);
    assert.doesNotMatch(view.captureCharFrame(), /Quantization:/);
    await act(async () => view.mockInput.pressTab());
    await act(async () => view.mockInput.pressEnter());
    await view.flush();
    assert.match(view.captureCharFrame(), /Quantization:.*1\/30/);
    assert.doesNotMatch(view.captureCharFrame(), /Model:/);
    await act(async () => view.mockInput.pressArrow("right"));
    await view.flush();
    assert.match(view.captureCharFrame(), /Overview/);
    assert.doesNotMatch(view.captureCharFrame(), /Quantization:|Model:/);
    await act(async () => {
      view.mockInput.pressEscape();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await view.flush();
    assert.equal(closed, 0);
    assert.match(view.captureCharFrame(), /Model:.*1\/20/);
    await act(async () => {
      view.mockInput.pressEscape();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.equal(closed, 1);
  } finally {
    await view.dispose();
  }
});
