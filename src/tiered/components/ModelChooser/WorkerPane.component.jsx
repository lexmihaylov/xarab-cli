import React from "react";
import { getTheme } from "../../../utils/theme-engine.js";
import { MarqueeText } from "../../../components/MarqueeText.component.jsx";
import { Pane } from "./Pane.component.jsx";
import { effortLabel, workerKey } from "../../../utils/worker-effort.js";

const colors = getTheme().colors;

export function WorkerPane({
  tier,
  workerOptions,
  visibleWorkers,
  workerIndex,
  configuredWorker,
  worker,
  workerScroll,
  workerQuery,
  setWorkerQuery,
  activeControl,
  loadingProviderModels,
  providerModelError,
}) {
  const pane = (index, title, children, footer) => (
    <Pane index={index} title={title} footer={footer} activeControl={activeControl}>
      {children}
    </Pane>
  );
  return pane(
  2,
  `03 TIER ${tier} WORKER`,
  workerOptions.length ? (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <box flexShrink={0} flexDirection="column">
        <box height={1} backgroundColor={colors.border} paddingX={1}>
          <input
            value={workerQuery}
            placeholder="Search worker models…"
            placeholderColor={colors.text}
            focused={activeControl === 2}
            onInput={setWorkerQuery}
            width="100%"
          />
        </box>
      </box>
      <box height={1} flexShrink={0} />
      <scrollbox
        ref={workerScroll}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: "column" }}
      >
        {visibleWorkers.map((option, index) => {
          const selected = activeControl === 2 && index === workerIndex;
          const configured =
            option.value.provider === configuredWorker?.provider &&
            option.value.model === worker &&
            option.value.effort === configuredWorker?.effort;
          return (
            <box
              key={workerKey(option.value)}
              id={`worker-${index}`}
              flexDirection="column"
              flexShrink={0}
              backgroundColor={selected ? colors.selected : undefined}
              paddingX={1}
            >
              <MarqueeText
                fg={
                  configured ? colors.green : selected ? colors.selectedText : colors.text
                }
                bold={selected || configured}
                active={selected}
              >
                {`${selected ? "› " : "· "}${option.name}${configured ? " ✓" : ""}`}
              </MarqueeText>
            </box>
          );
        })}
        {!visibleWorkers.length && <text fg={colors.muted}>No matching models</text>}
      </scrollbox>
    </box>
  ) : (
    <text fg={colors.muted} wrapMode="word">
      Connect a provider to choose a worker.
    </text>
  ),
  loadingProviderModels
    ? "Loading providers…"
    : providerModelError || "Type to filter · ↑↓ choose · Ctrl+R refresh",
  );
}
