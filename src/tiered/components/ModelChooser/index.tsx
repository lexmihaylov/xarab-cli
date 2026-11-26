import { workerVariants, effortLabel, workerKey } from "../../../utils/worker-effort.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { getTheme } from "../../../utils/theme-engine.js";

const colors = getTheme().colors;
import { Modal } from "../../../components/Modal.component.jsx";
import { RouterPane } from "./RouterPane.component.jsx";
import { TierPane } from "./TierPane.component.jsx";
import { WorkerPane } from "./WorkerPane.component.jsx";

function providerLabel(provider) {
  return { local: "Local", openai: "OpenAI", openrouter: "OpenRouter" }[provider] ?? provider;
}

function modelLabel(modelPath, settings = {}) {
  return settings[modelPath]?.name?.trim() || modelPath.split(/[\\/]/).at(-1);
}

export function ModelChooser({
  models = [],
  modelSettings = {},
  classifier,
  tierWorkers = {},
  defaultOpenAIModel,
  loadingClassifier,
  loadingProviderModels,
  providerModelError,
  error,
  onClose,
  onSetClassifier,
  onSetTierWorker,
  onRefreshWorkerModels,
}) {
  const [tier, setTier] = useState(1);
  const [activeControl, setActiveControl] = useState(0);
  const [classifierIndex, setClassifierIndex] = useState(0);
  const [workerIndex, setWorkerIndex] = useState(0);
  const [routerQuery, setRouterQuery] = useState("");
  const [workerQuery, setWorkerQuery] = useState("");
  const classifierScroll = useRef(null);
  const workerScroll = useRef(null);
  const tierScroll = useRef(null);
  const renderer = useRenderer();
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const classifierOptions = useMemo(() => {
    const options = [
      { name: "Routing disabled", description: "Do not classify requests", value: null },
      ...models
        .filter((model) => model.provider !== "local")
        .map((model) => ({
          name: `${providerLabel(model.provider)} · ${model.name}`,
          description: model.id,
          value: { provider: model.provider, model: model.id },
        })),
    ];
    if (
      classifier?.provider !== "local" &&
      classifier?.model &&
      !models.some(
        (model) => model.provider === classifier.provider && model.id === classifier.model,
      )
    )
      options.push({
        name: `${providerLabel(classifier.provider)} · ${classifier.model}`,
        description: classifier.model,
        value: classifier,
      });
    return options;
  }, [classifier, models]);
  const workerOptions = useMemo(() => {
    const options = models
      .filter((model) => model.provider !== "local")
      .flatMap((model) =>
        workerVariants(model).map((value) => ({
          name: `${providerLabel(model.provider)} · ${model.name}${value.provider === "local" ? "" : ` · ${effortLabel(value)}`}`,
          description: model.id,
          value,
        })),
      );
    const known = new Set(options.map((option) => workerKey(option.value)));
    for (const worker of Object.values(tierWorkers)) {
      if (worker?.provider !== "local" && worker?.model && !known.has(workerKey(worker))) {
        options.push({
          name: `${providerLabel(worker.provider)} · ${worker.model} · ${effortLabel(worker)}`,
          description: worker.model,
          value: worker,
        });
        known.add(workerKey(worker));
      }
    }
    if (
      defaultOpenAIModel &&
      !options.some(
        (option) => option.value.provider === "openai" && option.value.model === defaultOpenAIModel,
      )
    )
      options.push({
        name: `OpenAI · ${defaultOpenAIModel}`,
        description: defaultOpenAIModel,
        value: { provider: "openai", model: defaultOpenAIModel },
      });
    return options;
  }, [defaultOpenAIModel, models, tierWorkers]);
  const filterOptions = (options, query) =>
    options.filter((option) =>
      `${option.name} ${option.description}`.toLowerCase().includes(query.trim().toLowerCase()),
    );
  const visibleClassifiers = filterOptions(classifierOptions, routerQuery);
  const visibleWorkers = filterOptions(workerOptions, workerQuery);
  const configuredWorker = tierWorkers[tier];
  const worker = configuredWorker?.model || defaultOpenAIModel || "Worker not selected";
  const classifierLabel = classifier
    ? classifier.provider === "local"
      ? modelLabel(classifier.model, modelSettings)
      : classifier.model
    : "Router disabled";
  const isClassifierOptionConfigured = (option) => {
    if (option.value === null) return !classifier;
    const provider = typeof option.value === "string" ? "local" : option.value.provider;
    const model = typeof option.value === "string" ? option.value : option.value.model;
    return provider === classifier?.provider && model === classifier?.model;
  };

  useEffect(() => {
    const index = visibleClassifiers.findIndex((option) =>
      option.value === null
        ? !classifier
        : (typeof option.value === "string" ? "local" : option.value.provider) ===
            classifier?.provider &&
          (typeof option.value === "string" ? option.value : option.value.model) ===
            classifier?.model,
    );
    setClassifierIndex(Math.max(0, index));
  }, [classifier, routerQuery, models]);

  useEffect(() => {
    const index = visibleWorkers.findIndex(
      (option) =>
        option.value.provider === configuredWorker?.provider &&
        option.value.model === worker &&
        option.value.effort === configuredWorker?.effort,
    );
    setWorkerIndex(Math.max(0, index));
  }, [worker, configuredWorker?.effort, workerQuery, models, tier]);
  const usableWidth = Math.max(1, terminalWidth - 4);
  // Keep all three sections visible at practical widths. The worker section is
  // useful context for the selected tier, so it should not disappear on a
  // semi-large terminal just because the layout is below the full-screen width.
  const narrow = usableWidth < 92;
  const medium = usableWidth < 120;
  const visible = narrow
    ? [activeControl]
    : medium
      ? activeControl === 2
        ? [1, 2]
        : [0, 1]
      : [0, 1, 2];

  useEffect(() => {
    // The React commit precedes OpenTUI layout. Wait for a rendered frame so
    // newly mounted panes and their rows have usable coordinates.
    let frame = renderer.requestAnimationFrame(() => {
      frame = renderer.requestAnimationFrame(() => {
        const scroll = [classifierScroll, tierScroll, workerScroll][activeControl].current;
        const index = [classifierIndex, tier - 1, workerIndex][activeControl];
        if (!scroll || !scroll.viewport.height) return;
        // Each option is a single row. OpenTUI's scrollChildIntoView does not
        // move when the row and viewport have the same height.
        if (index < scroll.scrollTop) scroll.scrollTop = index;
        else if (index >= scroll.scrollTop + scroll.viewport.height)
          scroll.scrollTop = index - scroll.viewport.height + 1;
      });
    });
    return () => renderer.cancelAnimationFrame(frame);
  }, [
    renderer,
    activeControl,
    classifierIndex,
    workerIndex,
    tier,
    terminalWidth,
    terminalHeight,
    routerQuery,
    workerQuery,
    classifierOptions,
    workerOptions,
  ]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      onClose();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setActiveControl((current) => (current + (key.shift ? 2 : 1)) % 3);
      return;
    }
    // On narrow terminals only the active pane is rendered, so horizontal
    // navigation moves between the three sections.
    if (activeControl === 1 && (key.name === "left" || key.name === "right")) {
      key.preventDefault();
      setActiveControl((current) => (current + (key.name === "left" ? 2 : 1)) % 3);
      return;
    }
    if (activeControl === 1 && ["1", "2", "3"].includes(key.name)) {
      key.preventDefault();
      setActiveControl(Number(key.name) - 1);
      return;
    }
    if (key.name === "r" && activeControl === 2 && key.ctrl) {
      key.preventDefault();
      onRefreshWorkerModels();
      return;
    }
    if (activeControl === 0) {
      if (visibleClassifiers.length && (key.name === "up" || key.name === "down")) {
        key.preventDefault();
        setClassifierIndex(
          (current) =>
            (current + (key.name === "up" ? -1 : 1) + visibleClassifiers.length) %
            visibleClassifiers.length,
        );
      }
      if (key.name === "return" && visibleClassifiers[classifierIndex]) {
        key.preventDefault();
        onSetClassifier(visibleClassifiers[classifierIndex].value);
        setActiveControl(1);
      }
    } else if (activeControl === 1) {
      if (key.name === "up") setTier((value) => (value + 1) % 3 || 3);
      if (key.name === "down") setTier((value) => (value % 3) + 1);
      if (key.name === "return") setActiveControl(2);
    } else if (key.name === "up" || key.name === "down") {
      if (!visibleWorkers.length) return;
      key.preventDefault();
      setWorkerIndex((current) => {
        const delta = key.name === "up" ? -1 : 1;
        return (current + delta + visibleWorkers.length) % visibleWorkers.length;
      });
    } else if (key.name === "return") {
      const option = visibleWorkers[workerIndex];
      if (option) {
        key.preventDefault();
        onSetTierWorker(tier, option.value);
      }
    }
  });


  return (
    <Modal title="ROUTING & MODEL ASSIGNMENTS" fullScreen>
      <text fg={colors.muted} height={1} flexShrink={0} truncate>
        Select a router and assign a provider model to each tier.
      </text>
      <box
        height={3}
        flexShrink={0}
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={colors.border}
        paddingX={1}
        marginTop={1}
        marginBottom={1}
        minWidth={0}
      >
        <text height={1} flexShrink={0} fg={colors.text} truncate>
          {classifierLabel} → Tier {tier} → {worker}
        </text>
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1}>
        {visible.includes(0) && (
          <RouterPane
            visibleClassifiers={visibleClassifiers}
            classifierIndex={classifierIndex}
            isClassifierOptionConfigured={isClassifierOptionConfigured}
            classifierScroll={classifierScroll}
            routerQuery={routerQuery}
            setRouterQuery={setRouterQuery}
            activeControl={activeControl}
            loadingClassifier={loadingClassifier}
          />
        )}
        {visible.includes(1) && (
          <TierPane
            tier={tier}
            tierWorkers={tierWorkers}
            defaultOpenAIModel={defaultOpenAIModel}
            tierScroll={tierScroll}
            activeControl={activeControl}
          />
        )}
        {visible.includes(2) && (
          <WorkerPane
            tier={tier}
            workerOptions={workerOptions}
            visibleWorkers={visibleWorkers}
            workerIndex={workerIndex}
            configuredWorker={configuredWorker}
            worker={worker}
            workerScroll={workerScroll}
            workerQuery={workerQuery}
            setWorkerQuery={setWorkerQuery}
            activeControl={activeControl}
            loadingProviderModels={loadingProviderModels}
            providerModelError={providerModelError}
          />
        )}
      </box>
      <text
        height={1}
        flexShrink={0}
        fg={error || providerModelError ? colors.error : colors.muted}
        truncate
      >
        {error || providerModelError || " "}
      </text>
      <text height={1} flexShrink={0} fg={colors.hint} truncate>
        Tab choose section · ←→ edit search · ↑↓ select · Enter apply · Ctrl+R refresh · /connect
        providers · Esc close
      </text>
    </Modal>
  );
}
