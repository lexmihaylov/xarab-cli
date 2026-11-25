import React, { useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { getTheme } from "../utils/theme-engine.js";
import { workerVariants, workerKey, effortLabel } from "../utils/worker-effort.js";
import { Modal } from "../components/Modal.component.jsx";
import { MarqueeText } from "../components/MarqueeText.component.jsx";

const colors = getTheme().colors;

export function SingleModelChooser({
  models = [],
  modelSettings = {},
  singleModel,
  loadingProviderModels,
  providerModelError,
  error,
  onClose,
  onSetSingleModel,
  onSetModelContextSize,
  onSetModelInputBudget,
  onDeleteModel,
  onRefreshWorkerModels,
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [contextTarget, setContextTarget] = useState(null);
  const [budgetMode, setBudgetMode] = useState(false);
  const [contextInput, setContextInput] = useState("");
  const [contextError, setContextError] = useState("");
  const [savingContext, setSavingContext] = useState(false);
  const scroll = useRef(null);
  const options = models
    .flatMap((model) =>
      workerVariants(model).map((value) => ({
        value,
        name: `${model.provider} · ${model.name}${model.provider === "local" ? "" : ` · ${effortLabel(value)}`}`,
      })),
    )
    .filter((option) =>
      `${option.name} ${option.value.model}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
  const selectedIndex = Math.min(index, Math.max(0, options.length - 1));
  useEffect(() => {
    scroll.current?.scrollChildIntoView(`model-${selectedIndex}`);
  }, [selectedIndex]);
  useKeyboard((key) => {
    if (contextTarget) {
      if (key.name === "escape") {
        key.preventDefault();
        if (!savingContext) setContextTarget(null);
      } else if (key.name === "return") {
        key.preventDefault();
        if (savingContext) return;
        const text = contextInput.trim();
        const value = text === "" ? undefined : Number(text);
        if (text && (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0)) {
          setContextError("Enter a positive safe integer, or leave empty to reset.");
          return;
        }
        setContextError("");
        setSavingContext(true);
        Promise.resolve(
          (budgetMode ? onSetModelInputBudget : onSetModelContextSize)(contextTarget.model, value),
        )
          .then((success) => {
            if (success) setContextTarget(null);
          })
          .finally(() => setSavingContext(false));
      }
      return;
    }
    if (deleteTarget) {
      key.preventDefault();
      if (key.name === "return") {
        onDeleteModel?.(deleteTarget.model);
        setDeleteTarget(null);
      } else if (key.name === "escape") setDeleteTarget(null);
      return;
    }
    if (
      key.ctrl &&
      key.name === "g" &&
      options[selectedIndex]?.value.provider === "local" &&
      onSetModelContextSize
    ) {
      key.preventDefault();
      const target = options[selectedIndex].value;
      setBudgetMode(false);
      setContextTarget(target);
      setContextInput(modelSettings[target.model]?.contextSize?.toString() ?? "");
      setContextError("");
    } else if (
      key.ctrl &&
      key.name === "b" &&
      options[selectedIndex]?.value.provider === "local" &&
      onSetModelInputBudget
    ) {
      key.preventDefault();
      const target = options[selectedIndex].value;
      setBudgetMode(true);
      setContextTarget(target);
      setContextInput(modelSettings[target.model]?.inputBudget?.toString() ?? "");
      setContextError("");
    } else if (
      key.ctrl &&
      key.name === "d" &&
      options[selectedIndex]?.value.provider === "local" &&
      onDeleteModel
    ) {
      key.preventDefault();
      setDeleteTarget(options[selectedIndex].value);
    } else if (key.name === "escape") {
      key.preventDefault();
      onClose();
    } else if (key.ctrl && key.name === "r") {
      key.preventDefault();
      onRefreshWorkerModels?.();
    } else if ((key.name === "up" || key.name === "down") && options.length) {
      key.preventDefault();
      setIndex((selectedIndex + (key.name === "up" ? -1 : 1) + options.length) % options.length);
    } else if (key.name === "return" && options[selectedIndex]) {
      key.preventDefault();
      onSetSingleModel(options[selectedIndex].value);
    }
  });
  return (
    <Modal
      title="MODEL SELECTION"
      fullScreen
      dimmed={Boolean(deleteTarget || contextTarget)}
      overlay={
        contextTarget ? (
          <box
            position="absolute"
            top={0}
            right={0}
            bottom={0}
            left={0}
            zIndex={101}
            alignItems="center"
            justifyContent="center"
          >
            <box
              width="70%"
              maxWidth={72}
              flexDirection="column"
              backgroundColor={colors.overlay}
              border
              borderStyle="rounded"
              borderColor={colors.accent}
              paddingX={2}
              paddingY={1}
            >
              <text fg={colors.accent} bold>
                {budgetMode ? "LOCAL INPUT BUDGET" : "LOCAL CONTEXT SIZE"}
              </text>
              <text fg={colors.text} wrapMode="word">
                {contextTarget.model.split(/[\\/]/).at(-1)}
              </text>
              <text fg={colors.muted}>
                {budgetMode
                  ? "Estimated tokens · empty resets to 85% of context"
                  : "Positive integer · empty resets to default 16384"}
              </text>
              <input
                value={contextInput}
                focused={!savingContext}
                onInput={setContextInput}
                placeholder={budgetMode ? "Default: 85% of context" : "Default: 16384"}
                width="100%"
              />
              {(contextError || error) && (
                <text fg={colors.error} wrapMode="word">
                  {contextError || error}
                </text>
              )}
              <text fg={colors.hint}>{savingContext ? "Saving…" : "Enter save · Esc cancel"}</text>
            </box>
          </box>
        ) : (
          deleteTarget && (
            <box
              position="absolute"
              top={0}
              right={0}
              bottom={0}
              left={0}
              zIndex={101}
              alignItems="center"
              justifyContent="center"
            >
              <box
                width="58%"
                maxWidth={72}
                flexDirection="column"
                backgroundColor={colors.overlay}
                border
                borderStyle="rounded"
                borderColor={colors.error}
                paddingX={2}
                paddingY={1}
              >
                <text fg={colors.error} bold>
                  DELETE LOCAL MODEL
                </text>
                <text fg={colors.text} marginTop={1} wrapMode="word">
                  Delete {deleteTarget.model.split(/[\\/]/).at(-1)} from local storage? This cannot
                  be undone.
                </text>
                <text fg={colors.hint} marginTop={1}>
                  Enter confirm · Esc cancel
                </text>
              </box>
            </box>
          )
        )
      }
    >
      <text fg={colors.muted}>Choose one local or remote model.</text>
      <box
        border
        borderStyle="rounded"
        borderColor={colors.accent}
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
        paddingX={1}
      >
        <text fg={colors.accent} bold height={1} flexShrink={0}>
          MODEL
        </text>
        <input
          height={1}
          flexShrink={0}
          value={query}
          placeholder="Search models…"
          focused={!deleteTarget && !contextTarget}
          onInput={(value) => {
            setQuery(value);
            setIndex(0);
          }}
          width="100%"
        />
        <scrollbox
          key={query}
          ref={scroll}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          minHeight={0}
          overflow="hidden"
          scrollY
          scrollX={false}
          contentOptions={{ flexDirection: "column" }}
        >
          {options.map((option, i) => {
            const selected = i === selectedIndex;
            const configured =
              workerKey(option.value) === (singleModel ? workerKey(singleModel) : "");
            return (
              <box
                key={workerKey(option.value)}
                id={`model-${i}`}
                backgroundColor={selected ? colors.selected : undefined}
                paddingX={1}
                flexShrink={0}
              >
                <MarqueeText
                  fg={configured ? colors.green : selected ? colors.selectedText : colors.text}
                  bold={selected || configured}
                  active={selected && !deleteTarget}
                >{`${selected ? "› " : "· "}${option.name}${configured ? " ✓" : ""}`}</MarqueeText>
              </box>
            );
          })}
          {!options.length && (
            <text fg={colors.muted}>No matching models. Connect a provider or use /download.</text>
          )}
        </scrollbox>
      </box>
      {options[selectedIndex]?.value.provider === "local" && (
        <text fg={colors.muted} truncate>
          {`Context size: ${modelSettings[options[selectedIndex].value.model]?.contextSize ?? "16384 (default)"} · Input budget: ${modelSettings[options[selectedIndex].value.model]?.inputBudget ?? "85% (default)"}`}
        </text>
      )}
      <text fg={error || providerModelError ? colors.error : colors.muted} truncate>
        {error || providerModelError || (loadingProviderModels ? "Loading providers…" : " ")}
      </text>
      <text fg={colors.hint} truncate>
        {`Type to filter · ↑↓ choose · Enter apply · ${options[selectedIndex]?.value.provider === "local" && onSetModelContextSize ? "Ctrl+G context · Ctrl+B budget · " : ""}${options[selectedIndex]?.value.provider === "local" && onDeleteModel ? "Ctrl+D delete · " : ""}Ctrl+R refresh · Esc close`}
      </text>
    </Modal>
  );
}
