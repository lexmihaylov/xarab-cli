import React, { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useModelDetails } from "../../../components/hooks/use-model-details.js";
import {
  cleanModelText as clean,
  modelDetailRows,
} from "../../../utils/huggingface-model-formatter.js";
import { getDimmedColors, getTheme } from "../../../utils/theme-engine.js";
import { DownloadProgressDialog } from "../DownloadProgressDialog.component.jsx";
import { Modal } from "../../../components/Modal.component.jsx";

import { DetailsPane } from "./DetailsPane.component.jsx";
import { FilesPane } from "./FilesPane.component.jsx";
import { ResultsPane } from "./ResultsPane.component.jsx";
import { tabs } from "./tabs.js";

export function ModelDownloader({
  downloads = [],
  searching,
  downloading,
  canceling,
  downloadedSize,
  totalSize,
  downloadFileName,
  downloadNotice,
  progress = 0,
  error,
  query = "",
  searchQuery = "",
  onClose,
  onSearch,
  onDownloadSelected,
  onCancelDownload,
}) {
  // Keep the browser visible but subdued while the progress dialog owns input.
  const theme = getTheme();
  const colors = downloading ? getDimmedColors(theme) : theme.colors;
  const [search, setSearch] = useState(query);
  const [modelIndex, setModelIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState(0);
  const [active, setActive] = useState(0);
  const [detailTab, setDetailTab] = useState("Overview");
  const resultScroll = useRef(null);
  const fileScroll = useRef(null);
  const detailScroll = useRef(null);
  const { width: terminalWidth } = useTerminalDimensions();
  const screenWidth = Math.max(1, terminalWidth - 4);
  const narrow = screenWidth < 76;
  // File names need more room than the details preview. Only add that third
  // pane once every pane can retain a useful reading width.
  const threeColumns = screenWidth >= 132;
  const showResults = !narrow || active === 0 || active === 1;
  const showFiles = threeColumns || (narrow ? active === 2 : active !== 3);
  const showDetails = threeColumns || active === 3;
  // Keep every visible pane the same width. The row gap is included in the
  // calculation so the three bordered sections line up without overflowing.
  const visiblePaneCount = narrow ? 1 : threeColumns ? 3 : 2;
  const paneWidth = Math.max(
    1,
    Math.floor((screenWidth - (visiblePaneCount - 1)) / visiblePaneCount),
  );
  const leftWidth = paneWidth;
  const filesWidth = paneWidth;
  const detailWidth = paneWidth;
  const fileContentWidth = Math.max(1, filesWidth - 5);
  const fileSizeWidth = Math.min(12, Math.max(8, Math.floor(fileContentWidth / 2)));
  const fileNameWidth = Math.max(1, fileContentWidth - fileSizeWidth);
  const model = downloads[modelIndex];
  const detailState = useModelDetails(model?.name);
  const details = detailState.id === model?.name ? detailState.data : null;
  const files = details?.files ?? model?.files ?? [];
  const file = files[fileIndex];
  const detailContentWidth = Math.max(1, detailWidth - 5);
  const detailRows = useMemo(
    () => modelDetailRows(model, details, detailContentWidth, detailTab),
    [model, details, detailTab, detailContentWidth],
  );
  useEffect(() => {
    resultScroll.current?.scrollChildIntoView(`download-model-${modelIndex}`);
  }, [modelIndex, downloads, showResults, terminalWidth]);

  useEffect(() => {
    fileScroll.current?.scrollChildIntoView(`download-file-${fileIndex}`);
  }, [fileIndex, files, showFiles, terminalWidth]);

  useEffect(() => {
    detailScroll.current?.scrollTo(0);
  }, [detailTab, model?.name]);

  useEffect(() => {
    setModelIndex(0);
    setFileIndex(0);
  }, [downloads]);

  useEffect(() => {
    setFileIndex(0);
  }, [model?.name]);

  const submitSearch = () => {
    if (search.trim() && !downloading) {
      onSearch(search.trim());
      setActive(1);
    }
  };

  useKeyboard((key) => {
    if (downloading) {
      if (!canceling && key.name === "escape") {
        key.preventDefault();
        onCancelDownload();
      }
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      if (active === 0) onClose();
      else setActive(0);
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setActive((current) => (current + (key.shift ? 3 : 1)) % 4);
      return;
    }
    if (active === 0) {
      if (key.name === "down") setActive(1);
      return;
    }
    if (active === 1) {
      if (key.name === "up") setModelIndex((index) => Math.max(0, index - 1));
      if (key.name === "down")
        setModelIndex((index) => Math.min(Math.max(0, downloads.length - 1), index + 1));
      if (key.name === "right" || key.name === "return") setActive(2);
      if (key.name === "/") setActive(0);
      return;
    }
    if (active === 2) {
      if (key.name === "up") setFileIndex((index) => Math.max(0, index - 1));
      if (key.name === "down")
        setFileIndex((index) => Math.min(Math.max(0, files.length - 1), index + 1));
      if (key.name === "left") setActive(1);
      if (key.name === "right") setActive(3);
      if (key.name === "return" && file) onDownloadSelected(file.uri, file.fileName);
      return;
    }
    if (key.name === "left" || key.name === "right") {
      setDetailTab((current) => tabs[(tabs.indexOf(current) + (key.name === "right" ? 1 : 2)) % 3]);
    }
    const scroll = detailScroll.current;
    if (key.name === "up") scroll?.scrollBy(-1);
    if (key.name === "down") scroll?.scrollBy(1);
    if (key.name === "pageup") scroll?.scrollBy(-1, "viewport");
    if (key.name === "pagedown") scroll?.scrollBy(1, "viewport");
    if (key.name === "home") scroll?.scrollTo(0);
    if (key.name === "end") scroll?.scrollTo(scroll.scrollHeight);
  });

  const status =
    error ||
    (progress >= 1
      ? "Download complete."
      : searching
        ? "Searching Hugging Face…"
        : downloadNotice ||
          `${downloads.length} results${searchQuery ? ` for ${clean(searchQuery)}` : ""}`);
  return (
    <Modal title="DOWNLOAD A MODEL" fullScreen>
      <box
        height={4}
        flexShrink={0}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={!downloading && active === 0 ? colors.accent : colors.border}
        paddingX={1}
        marginBottom={1}
      >
        <text fg={colors.label} height={1} flexShrink={0}>
          Search Hugging Face
        </text>
        <input
          value={search}
          focused={!downloading && active === 0}
          placeholder="Model, family, or publisher"
          onInput={setSearch}
          onSubmit={submitSearch}
          width="100%"
          minWidth={0}
          flexGrow={1}
        />
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        {showResults && (
          <ResultsPane
            downloads={downloads}
            modelIndex={modelIndex}
            searching={searching}
            searchQuery={searchQuery}
            active={active}
            colors={colors}
            leftWidth={leftWidth}
            resultScroll={resultScroll}
          />
        )}
        {showFiles && (
          <FilesPane
            files={files}
            fileIndex={fileIndex}
            model={model}
            active={active}
            colors={colors}
            filesWidth={filesWidth}
            fileNameWidth={fileNameWidth}
            fileSizeWidth={fileSizeWidth}
            fileScroll={fileScroll}
          />
        )}
        {showDetails && (
          <DetailsPane
            model={model}
            detailState={detailState}
            detailTab={detailTab}
            detailRows={detailRows}
            active={active}
            colors={colors}
            detailWidth={detailWidth}
            detailScroll={detailScroll}
          />
        )}
      </box>
      {!downloading && (
        <>
          <text
            fg={error ? colors.error : progress >= 1 ? colors.green : colors.muted}
            height={1}
            flexShrink={0}
            truncate
          >
            {status}
          </text>
          <text fg={colors.hint} height={1} flexShrink={0} truncate>
            Tab switch pane · Enter search/download · Esc close
          </text>
        </>
      )}
      {downloading && (
        <DownloadProgressDialog
          fileName={downloadFileName || downloading.split("/").at(-1)}
          progress={progress}
          totalSize={totalSize}
          downloadedSize={downloadedSize}
          canceling={canceling}
        />
      )}
    </Modal>
  );
}
