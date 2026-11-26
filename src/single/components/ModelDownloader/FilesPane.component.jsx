import React from "react";
import { cleanModelText as clean } from "../../../utils/huggingface-model-formatter.js";

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "size unknown";
  const gigabytes = bytes / 1_000_000_000;
  return `${gigabytes < 10 ? gigabytes.toFixed(1) : Math.round(gigabytes)} GB`;
}

export function FilesPane({
  files,
  fileIndex,
  model,
  active,
  colors,
  filesWidth,
  fileNameWidth,
  fileSizeWidth,
  fileScroll,
}) {
  return (
    <box
      width={filesWidth}
      flexShrink={0}
      minWidth={0}
      minHeight={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={active === 2 ? colors.accent : colors.border}
      paddingX={1}
      overflow="hidden"
    >
      <box width="100%" minWidth={0} height={1} flexShrink={0} flexDirection="row">
        <text flexGrow={1} minWidth={0} fg={active === 2 ? colors.accent : colors.label} bold>
          Quantization:
        </text>
        <text flexShrink={0} fg={colors.muted}>
          {files.length ? `${fileIndex + 1}/${files.length}` : "0/0"}
        </text>
      </box>
      <text height={1} flexShrink={0} fg={colors.muted} truncate>
        {model ? clean(model.title ?? model.name) : "Select a model first"}
      </text>
      <box
        flexDirection="row"
        height={2}
        flexShrink={0}
        border={["bottom"]}
        borderColor={colors.border}
      >
        <text width={fileNameWidth} fg={colors.muted} truncate>
          File name
        </text>
        <box flexDirection="row" width={fileSizeWidth} justifyContent="flex-end">
          <text fg={colors.muted}>File size</text>
        </box>
      </box>
      <scrollbox
        ref={fileScroll}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: "column" }}
      >
        {files.map((item, index) => {
          const selected = index === fileIndex;
          return (
            <box
              key={item.uri ?? item.fileName}
              id={`download-file-${index}`}
              flexDirection="row"
              height={1}
              width="100%"
              flexShrink={0}
              backgroundColor={selected ? colors.selected : undefined}
            >
              <text
                width={fileNameWidth}
                fg={selected ? colors.selectedText : colors.text}
                bold={selected}
                truncate
              >
                {clean(item.fileName)}
              </text>
              <box flexDirection="row" width={fileSizeWidth} justifyContent="flex-end">
                <text fg={selected ? colors.selectedText : colors.text} truncate>
                  {formatSize(item.size)}
                </text>
              </box>
            </box>
          );
        })}
        {!files.length && (
          <text fg={colors.muted}>Select a model to view its GGUF files.</text>
        )}
      </scrollbox>
      <text height={1} flexShrink={0} fg={colors.hint} truncate>
        Enter download · → details
      </text>
    </box>
  );
}

