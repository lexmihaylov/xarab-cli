import React from "react";
import { cleanModelText as clean } from "../../../utils/huggingface-model-formatter.js";
import { tabs } from "./tabs.js";

export function DetailsPane({
  model,
  detailState,
  detailTab,
  detailRows,
  active,
  colors,
  detailWidth,
  detailScroll,
}) {
  return (
    <box
      width={detailWidth}
      flexGrow={0}
      flexShrink={0}
      minHeight={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={active === 3 ? colors.accent : colors.border}
      paddingX={1}
      overflow="hidden"
    >
      <box flexDirection="row" height={1} flexShrink={0} justifyContent="space-between">
        <text fg={active === 3 ? colors.accent : colors.label} bold truncate>
          {clean(model?.title ?? "MODEL DETAILS")}
        </text>
        <text fg={colors.muted}>{detailState.loading ? "…" : ""}</text>
      </box>
      <text height={1} flexShrink={0} fg={colors.muted} truncate>
        {model ? clean(model.name) : "Select a search result"}
      </text>
      <box flexDirection="row" height={3} flexShrink={0} gap={1} minWidth={0}>
        {tabs.map((tab) => {
          const selected = tab === detailTab;
          return (
            <box
              key={tab}
              flexGrow={1}
              flexBasis={0}
              minWidth={0}
              height={3}
              flexShrink={0}
              alignItems="center"
              justifyContent="center"
              border
              borderStyle="rounded"
              borderColor={selected ? colors.accent : colors.border}
            >
              <text fg={selected ? colors.accent : colors.muted} bold={selected} truncate>
                {tab}
              </text>
            </box>
          );
        })}
      </box>
      <scrollbox
        ref={detailScroll}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: "column" }}
      >
        {detailRows.map((item, index) => (
          <text
            key={`${index}-${item.text}`}
            height={1}
            flexShrink={0}
            fg={
              item.kind === "heading" || item.kind === "table-heading"
                ? colors.label
                : item.kind === "muted"
                  ? colors.muted
                  : colors.text
            }
            truncate
          >
            {item.label ? `${item.label}: ${item.text}` : item.text || " "}
          </text>
        ))}
      </scrollbox>
      <text fg={detailState.error ? colors.error : colors.hint} truncate>
        {detailState.error
          ? `Details unavailable: ${clean(detailState.error)}`
          : "←→ tabs · ↑↓ scroll · PgUp/PgDn page"}
      </text>
    </box>
  );
}
