import React from "react";
import { cleanModelText as clean, compactCount } from "../../../utils/huggingface-model-formatter.js";
import { MarqueeText } from "./MarqueeText.component.jsx";

export function ResultsPane({
  downloads,
  modelIndex,
  searching,
  searchQuery,
  active,
  colors,
  leftWidth,
  resultScroll,
}) {
  return (
    <box
      width={leftWidth}
      flexShrink={0}
      minHeight={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={active === 1 ? colors.accent : colors.border}
      paddingX={1}
      overflow="hidden"
    >
      <box width="100%" minWidth={0} height={1} flexShrink={0} flexDirection="row">
        <text flexGrow={1} minWidth={0} fg={active === 1 ? colors.accent : colors.label} bold>
          Model:
        </text>
        <text flexShrink={0} fg={colors.muted}>
          {downloads.length ? `${modelIndex + 1}/${downloads.length}` : "0/0"}
        </text>
      </box>
      <scrollbox
        ref={resultScroll}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: "column" }}
      >
        {!downloads.length && (
          <text fg={colors.muted}>
            {searching
              ? "Finding models…"
              : searchQuery
                ? "No matching models"
                : "Find your next model"}
          </text>
        )}
        {downloads.map((item, index) => {
          const selected = index === modelIndex;
          return (
            <box
              key={item.name}
              id={`download-model-${index}`}
              width="100%"
              flexDirection="column"
              flexShrink={0}
              backgroundColor={selected ? colors.selected : undefined}
            >
              <MarqueeText
                text={`${selected ? "▸" : " "} ${clean(item.title ?? item.name.split("/").at(-1))}`}
                width={Math.max(1, leftWidth - 5)}
                active={selected}
                fg={selected ? colors.selectedText : colors.accent}
                bold
              />
              <text
                fg={selected ? colors.selectedText : colors.label}
                bold={selected}
                truncate
              >
                {"  "}
                {clean(item.publisher ?? item.name.split("/")[0])}
              </text>
              <text fg={selected ? colors.selectedText : colors.muted} truncate>
                {"  "}
                {item.parameters ? `~${item.parameters} · ` : ""}
                {item.files.length} {item.files.length === 1 ? "variant" : "variants"}
                {Number.isFinite(item.downloads)
                  ? ` · ${compactCount(item.downloads)} pulls`
                  : ""}
              </text>
            </box>
          );
        })}
      </scrollbox>
      <text height={1} flexShrink={0} fg={colors.hint} truncate>
        ↑↓ browse · Enter quantizations
      </text>
    </box>
  );
}

