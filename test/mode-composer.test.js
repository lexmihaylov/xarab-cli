import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { Composer as SingleComposer } from "../src/single/components/Composer.component.jsx";
import { Composer as TieredComposer } from "../src/tiered/components/Composer.component.jsx";

for (const [name, Composer, present, absent] of [
  ["single", SingleComposer, ["/model", "/download"], ["/route"]],
  ["tiered", TieredComposer, ["/route"], ["/model", "/download"]],
]) {
  test(`${name} composer suggests only its own mode commands`, async () => {
    const view = await testRender(
      React.createElement(Composer, {
        draft: { value: "/", cursor: 1 },
        onDraftChange() {},
        onSubmit() {},
      }),
      { width: 100, height: 30 },
    );
    try {
      await view.flush();
      const frame = view.captureCharFrame();
      for (const command of present) assert.ok(frame.includes(command), frame);
      for (const command of absent) assert.ok(!frame.includes(command), frame);
      assert.match(frame, /\/help/);
    } finally {
      await act(async () => view.dispose());
    }
  });
}
