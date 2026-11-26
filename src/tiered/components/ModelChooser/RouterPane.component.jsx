import React from "react";
import { getTheme } from "../../../utils/theme-engine.js";
import { MarqueeText } from "../../../components/MarqueeText.component.jsx";
import { Pane } from "./Pane.component.jsx";

const colors = getTheme().colors;

export function RouterPane({
  visibleClassifiers,
  classifierIndex,
  isClassifierOptionConfigured,
  classifierScroll,
  routerQuery,
  setRouterQuery,
  activeControl,
  loadingClassifier,
}) {
  const pane = (index, title, children, footer) => (
    <Pane index={index} title={title} footer={footer} activeControl={activeControl}>
      {children}
    </Pane>
  );
  return pane(
  0,
  "01 ROUTER MODEL",
  <box flexGrow={1} minHeight={0} flexDirection="column">
    <box flexShrink={0} flexDirection="column">
      <box height={1} backgroundColor={colors.border} paddingX={1}>
        <input
          value={routerQuery}
          placeholder="Search router models…"
          placeholderColor={colors.text}
          focused={activeControl === 0}
          onInput={setRouterQuery}
          width="100%"
        />
      </box>
    </box>
    <box height={1} flexShrink={0} />
    <scrollbox
      ref={classifierScroll}
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      overflow="hidden"
      scrollY
      scrollX={false}
      contentOptions={{ flexDirection: "column" }}
    >
      {visibleClassifiers.map((option, index) => {
        const selected = activeControl === 0 && index === classifierIndex;
        const configured = isClassifierOptionConfigured(option);
        return (
          <box
            key={option.name}
            id={`router-${index}`}
            flexDirection="column"
            flexShrink={0}
            minWidth={0}
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
      {!visibleClassifiers.length && <text fg={colors.muted}>No matching models</text>}
    </scrollbox>
  </box>,
  loadingClassifier ? "Loading locally…" : "Type to filter · ↑↓ select · Enter next",
  );
}
