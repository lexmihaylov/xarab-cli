import "./runtime-environment.js";
import React, { useEffect, useState } from "react";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createAssistantController } from "./agent/controller.js";
import { loadProjectInstructions } from "./agent/worker/instructions.js";
import { createMarkdownStyle } from "./utils/markdown-style.js";
import { createDiagnosticLog } from "./utils/diagnostic-log.js";
export async function startApp({ appPolicy, App, releaseInstanceLock }) {
  const diagnostics = createDiagnosticLog(path.join(os.homedir(), ".xarab", "xarab.log"));
  process.on("warning", (warning) => {
    void diagnostics.append("warning", `${warning.name}: ${warning.message}`);
  });

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = process.cwd();
  const dataDir = path.join(os.homedir(), ".xarab");
  const modelsDir = path.resolve(
    process.env.XARAB_MODELS_DIR || path.join(os.homedir(), ".xarab", "models"),
  );
  const instructionFiles = await loadProjectInstructions(workspace);
  const renderer = await createCliRenderer({ screenMode: "alternate-screen", useMouse: true });
  const syntaxStyle = createMarkdownStyle(renderer.nativeScene);
  const ui = createRoot(renderer);
  let controller;
  let updateAppState;
  let shuttingDown = false;

  function Root({ initialState }) {
    const [state, setState] = useState(initialState);

    useEffect(() => {
      updateAppState = setState;
      return () => {
        updateAppState = undefined;
      };
    }, []);

    return renderApp(state);
  }

  function renderApp(state) {
    return (
      <App
        state={state}
        workspace={workspace}
        syntaxStyle={syntaxStyle}
        onSubmit={(value) => void controller.submit(value)}
        onAnswerQuestions={controller.answerQuestions}
        onRemoveQueuedMessage={controller.removeQueuedMessage}
        onStopGeneration={controller.stopGeneration}
        onDraftChange={controller.updateDraft}
        onCloseModelModal={controller.closeModelModal}
        onCloseProviders={controller.closeProviderModal}
        onProviderAction={controller.providerAction}
        onDownloadSelectedModel={controller.downloadSelectedModel}
        onCancelModelDownload={controller.cancelModelDownload}
        onSearchHuggingFace={controller.searchHuggingFace}
        onSetSingleModel={controller.setSingleModel}
        onSetModelContextSize={controller.setModelContextSize}
        onSetModelInputBudget={controller.setModelInputBudget}
        onSetRouterClassifier={controller.setRouterClassifier}
        onSetRouterTierWorker={controller.setRouterTierWorker}
        onDeleteModel={controller.deleteModel}
        onRefreshRouterWorkerModels={controller.refreshRouterWorkerModels}
        onOpenSessions={controller.openSessionPicker}
        onCloseSessions={controller.closeSessionPicker}
        onRestoreSession={controller.restoreSession}
        onNewSession={controller.startNewSession}
        onDeleteSession={controller.deleteSession}
        onRenameSession={controller.renameSession}
      />
    );
  }

  async function quit() {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await controller.shutdown();
      ui.unmount();
      renderer.destroy();
      syntaxStyle.destroy();
      if (controller.getState().sessionError) {
        await diagnostics.append(
          "error",
          "Session shutdown reported an error (details displayed on stderr).",
        );
        console.error(controller.getState().sessionError);
      }
    } finally {
      await releaseInstanceLock?.().catch(async (error) => {
        await diagnostics.append(
          "error",
          `Could not release Xarab instance lock: ${error.message}`,
        );
        console.error(`Could not release Xarab instance lock: ${error.message}`);
      });
      await diagnostics.flush();
    }
  }

  controller = createAssistantController({
    appPolicy,
    root,
    modelsDir,
    configPath: path.join(dataDir, "config.json"),
    routingConfigPath: path.join(os.homedir(), ".xarab", "routing.conf"),
    sessionsDir: path.join(dataDir, "sessions"),
    workspace,
    instructionFiles,
    onQuit: quit,
    onStateChange(state) {
      updateAppState?.(state);
    },
  });

  ui.render(<Root initialState={controller.getState()} />);
  await controller.initialize();
}
