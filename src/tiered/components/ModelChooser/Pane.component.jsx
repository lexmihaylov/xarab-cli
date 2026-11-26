import React from "react";
import { getTheme } from "../../../utils/theme-engine.js";

const colors = getTheme().colors;

export function Pane({ index, title, children, footer, activeControl }) {
  return (
    <box
      key={index}
      flexGrow={1}
      flexBasis={0}
      minWidth={0}
      minHeight={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={activeControl === index ? colors.accent : colors.border}
      paddingX={1}
    >
      <text
        height={1}
        flexShrink={0}
        fg={activeControl === index ? colors.accent : colors.label}
        bold
        truncate
      >
        {title}
      </text>
      {index === 1 && <box height={1} flexShrink={0} />}
      <box flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden" flexDirection="column">
        {children}
      </box>
      <box height={1} flexShrink={0} overflow="hidden" backgroundColor={colors.overlay}>
        <text height={1} fg={colors.hint} truncate>
          {footer}
        </text>
      </box>
    </box>
  );
}

