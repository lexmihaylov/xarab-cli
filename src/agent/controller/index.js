import { createQuestionRequest } from ".././question-request.js";
import os from "node:os";
import path from "node:path";
import { createMessageTimeline } from ".././message-timeline.js";
import { resolveAppPolicy } from ".././app-policy.js";
import { downloadModelFile } from "../../utils/model-downloader.js";
import { createSessionStore } from ".././session-store.js";
import { createSessionController } from ".././session-controller.js";
import { createOpenAICodexAuth } from "../../utils/openai-codex-auth.js";
import { runWorker as runWorkerTurn } from "./worker-turn.js";
import { createTurnCoordinator } from "./turn-coordinator.js";
import { createActiveWork } from "./active-work.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import {
  createOpenAIResponsesWorkerAdapter,
  createLocalLlamaWorkerAdapter,
} from ".././worker/index.js";
import {
  createClassifier,
  createLocalLlamaClassifierAdapter,
  createOpenAIResponsesClassifierAdapter,
} from ".././classifier/index.js";
import { createModelManager } from ".././local-model-manager.js";
import { createRemoteModelDiscovery } from "./remote-model-discovery.js";
import { createWorker } from ".././worker/worker.js";
import { createOpenRouterWorkerAdapter } from ".././worker/openrouter-worker-adapter.js";
import { createCommandHandler } from ".././assistant-command-handler.js";
import { createProviderModal } from "./provider-modal.js";
import { createProviderConnections } from ".././provider-connections.js";
import { createSessionCompactor } from ".././session-compactor.js";
import { createAutoCompactor } from ".././auto-compactor.js";
import { createTaskIntegration } from ".././task-integration.js";
import { createLocalWorkerRuntime } from ".././worker/local-worker-runtime.js";

export function createAssistantController({
  root,
  mode,
  appPolicy = resolveAppPolicy(mode),
  modelsDir = path.join(root, "models"),
  configPath = path.join(os.homedir(), ".xarab", "config.json"),
  routingConfigPath = path.join(path.dirname(configPath), "routing.conf"),
  workspace = process.cwd(),
  instructionFiles,
  onStateChange = () => {},
  onQuit = () => {},
  downloadFile = downloadModelFile,
  clipboardWriter = copyToClipboard,
  classifierFactory = createClassifier,
  localClassifierAdapterFactory = createLocalLlamaClassifierAdapter,
  openAIClassifierAdapterFactory = createOpenAIResponsesClassifierAdapter,
  openAIAdapterFactory = createOpenAIResponsesWorkerAdapter,
  localWorkerAdapterFactory = createLocalLlamaWorkerAdapter,
  automaticTitles,
  automaticSuggestions,
  sessionsDir = path.join(path.dirname(configPath), "sessions"),
}) {
  let status = "Ready";
  const activeWork = createActiveWork();
  const { isGenerating, isRouting } = activeWork;
  let commandRunning = false;
  let turnCoordinator;
  let messages = [];
  let currentAgentMessage;
  let suggestion = null;
  let suggestionVersion = 0;
  let pendingShellContext = [];
  const sessionStore = createSessionStore(sessionsDir);
  let sessionPersisted = false;
  let shutdownPromise;
  let modelDeletion;
  let changingSingleModel = false;
  let isShuttingDown = false;
  let modelModal = null;
  let chooserIdentity;
  let providerModalController;
  let activeDownload;
  let nextDownloadId = 0;
  const configStore = appPolicy.createConfigStore(configPath, routingConfigPath);
  const workerPolicy = appPolicy.createWorkerPolicy(configStore);
  const { remoteOnly, chooserCommand } = appPolicy;
  const openAIAuth = createOpenAICodexAuth({
    credentialsPath: path.join(path.dirname(configPath), "auth", "openai-chatgpt.json"),
  });
  const loadRouterWorkerModels = createRemoteModelDiscovery({
    getCredentials: () => openAIAuth.getCredentials(),
    getOpenRouterApiKey: () => configStore.getApiKey("openrouter"),
    getChooserIdentity: () => (modelModal?.mode === "chooser" ? chooserIdentity : undefined),
    getModelModal: () => modelModal,
    setModelModal: (next) => {
      modelModal = next;
    },
    notify,
  });
  let worker;
  const routing = appPolicy.createRouting({
    configStore,
    remoteOnly,
    classifierFactory,
    localClassifierAdapterFactory,
    openAIClassifierAdapterFactory,
    openAIAuth,
    updateStatus,
    getMessages: () => messages,
    getWorker: () => worker,
    runClassification,
  });
  const taskPolicy = appPolicy.createTaskPolicy(configStore, routing);
  const chooserActions = appPolicy.createChooserActions({
    configStore,
    remoteOnly,
    routing,
    getModelModal: () => modelModal,
    setModelModal: (next) => {
      modelModal = next;
    },
    notify,
    updateStatus,
    isBusy: () =>
      turnCoordinator.isTurnRunning() ||
      isGenerating() ||
      isRouting() ||
      commandRunning ||
      localRuntime.isBusy(),
  });
  const classifyForRouting = routing.classifyForRouting;
  const localRuntime = createLocalWorkerRuntime(
    () =>
      localWorkerAdapterFactory({
        getContextSize: (modelPath) => configStore.getModel?.(modelPath)?.contextSize,
        getInputBudget: (modelPath) => configStore.getModel?.(modelPath)?.inputBudget,
      }),
    {
      unavailableReason: () => {
        if (isShuttingDown) return "The assistant is shutting down.";
        if (modelManager.isModelDeletionPending())
          return "Wait for local model deletion to finish.";
        if (changingSingleModel) return "Wait for the model change to finish.";
      },
    },
  );
  let sessionController;
  const tasks = createTaskIntegration({
    workspace,
    taskPolicy,
    createWorker: ({ onToolEvent, mode }) =>
      createWorker({
        configStore,
        workerPolicy,
        remoteOnly,
        openAIAdapterFactory,
        openRouterAdapterFactory: () =>
          createOpenRouterWorkerAdapter({ getApiKey: () => configStore.getApiKey("openrouter") }),
        localAdapterFactory: () =>
          localRuntime.createAdapter({ wait: mode === "utility", validate: mode === "validation" }),
        getCredentials: () => openAIAuth.getCredentials(),
        getOpenAIStatus: () => openAIAuth.getStatus(),
        workspace,
        instructionFiles,
        toolRuntime: {
          async requestQuestions(questions, options) {
            onToolEvent?.("approval", { type: "pending" });
            try {
              return await questionRequest.request(questions, options);
            } finally {
              onToolEvent?.("approval", { type: "finished" });
            }
          },
          assessCommand: (request) => tasks.assessCommand(request),
          onToolEvent,
          onDiagnosticEvent: onToolEvent,
        },
      }),
    getSession: () => sessionController.getActiveSession(),
    async applyTitle(session, title) {
      if (isShuttingDown || sessionController.getActiveSession() !== session || session.manualTitle)
        return;
      session.title = title;
      sessionController.sessionChanged();
      notify();
      await sessionController.saveCurrentSession();
    },
    warn: (message) => addMessage({ type: "system", message, severity: "warning" }),
    getCurrentAgentMessage: () => currentAgentMessage,
    sessionChanged: () => sessionController.sessionChanged(),
    notify,
    titlesEnabled: () => automaticTitles ?? configStore.get().automaticTitles !== false,
  });
  const questionRequest = createQuestionRequest({ notify });

  function getState() {
    return {
      messages: messages.map((message) => ({
        ...message,
        parts: message.parts?.map((part) => ({
          ...part,
          params: part.params ? { ...part.params } : undefined,
        })),
      })),
      ...appPolicy.modelState(configStore),
      status,
      suggestion,
      generating: isGenerating() || turnCoordinator.isTurnRunning(),
      commandRunning,
      queuedMessages: turnCoordinator.getQueuedMessages(sessionController.getActiveSession().id),
      questionDialog: questionRequest.getState(),
      modelModal,
      providerModal: providerModalController?.getState() ?? null,
      ...sessionController.getState(),
    };
  }

  function notify() {
    onStateChange(getState());
  }

  function updateStatus(nextStatus = "Ready") {
    status = nextStatus;
    notify();
  }

  const timeline = createMessageTimeline({
    getMessages: () => messages,
    getCurrentAgentMessage: () => currentAgentMessage,
    getActiveSession: () => sessionController?.getActiveSession(),
    onFirstUserMessage: tasks.onFirstUserMessage,
    sessionChanged: () => sessionController?.sessionChanged(),
    notify,
  });
  const { addMessage, appendAssistantText, onToolEvent } = timeline;

  sessionController = createSessionController({
    workspace,
    sessionStore,
    onSessionLeave: () => {
      tasks.cancelTitle();
      clearSuggestion();
    },
    getMessages: () => messages,
    setMessages: (next) => {
      messages = next;
    },
    getPendingShellContext: () => pendingShellContext,
    setPendingShellContext: (next) => {
      pendingShellContext = next;
    },
    addMessage,
    notify,
    updateStatus: (nextStatus) => updateStatus(appPolicy.sessionStatus(configStore, nextStatus)),
    isGenerating: () =>
      isGenerating() || (turnCoordinator.isTurnRunning() && !turnCoordinator.isCompletionSaving()),
    isRouting,
    isReplyComplete: () => turnCoordinator.isReplyComplete(),
    getActiveDownload: () => activeDownload,
    isShuttingDown: () => isShuttingDown,
    getSessionPersisted: () => sessionPersisted,
    setSessionPersisted: (next) => {
      sessionPersisted = next;
    },
  });

  const {
    getActiveSession,
    sessionChanged,
    saveCurrentSession,
    startNewSession,
    openSessionPicker,
    closeSessionPicker,
    restoreSession,
    renameSession,
    deleteSession,
    updateDraft: updateSessionDraft,
    isSessionOperation,
    setSessionError,
  } = sessionController;

  function clearSuggestion() {
    suggestionVersion++;
    tasks.cancelSuggestion();
    if (suggestion !== null) {
      suggestion = null;
      notify();
    }
  }

  function updateDraft(draft) {
    clearSuggestion();
    updateSessionDraft(draft);
  }

  worker = createWorker({
    configStore,
    workerPolicy,
    remoteOnly,
    openAIAdapterFactory,
    openRouterAdapterFactory: () =>
      createOpenRouterWorkerAdapter({ getApiKey: () => configStore.getApiKey("openrouter") }),
    localAdapterFactory: () => localRuntime.createAdapter({ wait: true }),
    getCredentials: () => openAIAuth.getCredentials(),
    getOpenAIStatus: () => openAIAuth.getStatus(),
    workspace,
    instructionFiles,
    toolRuntime: {
      taskTool: tasks.taskTool,
      assessCommand: tasks.assessCommand,
      requestQuestions: questionRequest.request,
      onToolEvent,
      getMessages: () => messages,
      getCurrentAgentMessage: () => currentAgentMessage,
      sessionChanged,
      notify,
    },
  });

  const providers = createProviderConnections({
    chooserCommand,
    openAIAuth,
    clipboardWriter,
    onOpenAIConnected: loadRouterWorkerModels,
    onOpenRouterChanged: loadRouterWorkerModels,
    configStore,
  });

  const { openProviderModal, closeProviderModal, providerAction } = (providerModalController =
    createProviderModal({
      providers,
      chooserCommand,
      closeModelModalForProvider: () => {
        modelModal = null;
      },
      notify,
    }));

  function runWorker(promptText, options) {
    if (isShuttingDown || turnCoordinator.isTurnInterrupted()) {
      return;
    }
    return runWorkerTurn(
      {
        activeWork,
        get messages() {
          return messages;
        },
        get pendingShellContext() {
          return pendingShellContext;
        },
        set pendingShellContext(value) {
          pendingShellContext = value;
        },
        set currentAgentMessage(value) {
          currentAgentMessage = value;
        },
        get suggestionVersion() {
          return suggestionVersion;
        },
        set suggestion(value) {
          suggestion = value;
        },
        get isShuttingDown() {
          return isShuttingDown;
        },
        get status() {
          return status;
        },
        get autoCompactor() {
          return autoCompactor;
        },
        get turnCoordinator() {
          return turnCoordinator;
        },
        addMessage,
        appendAssistantText,
        updateStatus,
        getActiveSession,
        appPolicy,
        configStore,
        worker,
        routing,
        sessionController,
        sessionChanged,
        saveCurrentSession,
        setSessionError,
        notify,
        tasks,
        automaticSuggestions,
      },
      promptText,
      options,
    );
  }

  function runClassification(classify) {
    if (isShuttingDown || turnCoordinator.isTurnInterrupted()) {
      return { cancelled: true };
    }

    // Only the compactors route while an operation is active; their routing call is
    // synchronous up to entering runClassification. Share its cancellation lifetime.
    const current = activeWork.getCurrent();
    const parent = ["manual-compaction", "auto-compaction"].includes(current?.kind)
      ? current
      : undefined;
    return activeWork.run(
      "classification",
      async (operation) => {
        const { signal } = operation;
        let route;
        try {
          updateStatus("Classifying…");
          if (signal.aborted) {
            return { cancelled: true };
          }
          route = await classify(signal, ({ attempt, maxRetries }) =>
            updateStatus(`Classification timed out; retrying (${attempt}/${maxRetries})…`),
          );
        } catch (error) {
          if (signal.aborted) {
            return { cancelled: true };
          }
          throw error;
        } finally {
          operation.setGenerating(false);
          updateStatus("Ready");
        }
        return signal.aborted ? { cancelled: true } : route;
      },
      { parent },
    );
  }

  function stopGeneration() {
    if (!activeWork.getCurrent() && !turnCoordinator.isTurnRunning()) {
      return;
    }
    turnCoordinator.pauseQueue();
    turnCoordinator.markInterrupted();
    activeWork.abort();
    updateStatus("Stopping…");
  }

  function shutdown() {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    isShuttingDown = true;
    shutdownPromise = Promise.resolve().then(async () => {
      // Checkpoint after requesting abort, even if the worker is slow to unwind.
      // The session controller serializes this with any saves already in flight.
      try {
        await saveCurrentSession();
      } catch (error) {
        addMessage({
          type: "system",
          message: `Session could not be saved on exit: ${error.message}`,
          severity: "error",
        });
      }
      await Promise.all([activeWork.whenIdle(), turnCoordinator.whenIdle()]);
      await tasks.shutdown();
      try {
        await sessionController.shutdownSession();
      } catch (error) {
        addMessage({
          type: "system",
          message: `Session could not be saved on exit: ${error.message}`,
          severity: "error",
        });
      }
      await activeDownload?.promise;
      await modelDeletion;
      try {
        await routing.currentClassifier?.()?.dispose?.();
        await worker.dispose();
      } finally {
        await localRuntime.dispose();
      }
    });
    turnCoordinator.markInterrupted();
    activeWork.abort();
    tasks.cancelTitle();
    clearSuggestion();
    questionRequest.respond(null);
    activeDownload?.controller.abort();
    return shutdownPromise;
  }

  async function initialize() {
    await configStore.load();
    updateStatus(appPolicy.initialStatus(configStore));
  }

  function closeModelModal() {
    if (activeDownload) return modelManager.cancelModelDownload();
    modelModal = null;
    notify();
  }

  const modelManager = createModelManager({
    appMode: appPolicy.canDeleteLocalModels ? "single" : undefined,
    isLocalModelInUse: () =>
      isShuttingDown ||
      changingSingleModel ||
      turnCoordinator.isTurnRunning() ||
      isGenerating() ||
      isRouting() ||
      commandRunning ||
      Boolean(activeWork.getCurrent()) ||
      tasks.hasPendingWork() ||
      localRuntime.isBusy(),
    unloadLocalRuntime: localRuntime.unload,
    modelsDir,
    configStore,
    downloadFile,
    notify,
    addMessage,
    getModelModal: () => modelModal,
    setModelModal: (next) => {
      modelModal = next;
    },
    getActiveDownload: () => activeDownload,
    setActiveDownload: (next) => {
      activeDownload = next;
    },
    getNextDownloadId: () => nextDownloadId,
    setNextDownloadId: (next) => {
      nextDownloadId = next;
    },
    getTierClassifier: routing.currentClassifier ?? (() => undefined),
    clearTierClassifier: routing.clearClassifier ?? (() => {}),
  });

  const autoCompactor = createAutoCompactor({
    getMessages: () => messages,
    setMessages: (next) => {
      messages = next;
    },
    classifyForRouting,
    worker,
    addMessage,
    sessionChanged,
    notify,
    updateStatus,
    activeWork,
    isShuttingDown: () => isShuttingDown,
  });

  const sessionCompactor = createSessionCompactor({
    getMessages: () => messages,
    setMessages: (next) => {
      messages = next;
    },
    missingModelMessage: appPolicy.compactionMessage,
    setCurrentAgentMessage: (next) => {
      currentAgentMessage = next;
    },
    addMessage,
    classifyForRouting,
    worker,
    sessionChanged,
    notify,
    updateStatus,
    activeWork,
    isShuttingDown: () => isShuttingDown,
    isSessionOperation,
  });

  const commandHandler = createCommandHandler({
    workspace,
    commandPolicy: appPolicy.commands,
    routeMessage: (text) => appPolicy.routeMessage?.(configStore, text, { runWorker, addMessage }),
    addMessage,
    updateStatus,
    notify,
    getPendingShellContext: () => pendingShellContext,
    setPendingShellContext: (next) => {
      pendingShellContext = next;
    },
    sessionChanged,
    isGenerating,
    isRouting,
    getCommandRunning: () => commandRunning,
    setCommandRunning: (next) => {
      commandRunning = next;
    },
    openSessionPicker,
    startNewSession,
    saveCurrentSession,
    getActiveSession,
    compactSession: sessionCompactor.compact,
    openProviderModal,
    openModelChooser: async () => {
      const chooserState = await appPolicy.chooserState(configStore, modelManager);
      chooserIdentity = {};
      modelModal = {
        ...chooserState,
        directory: modelsDir,
        loadingProviderModels: false,
        mode: "chooser",
      };
      notify();
      void loadRouterWorkerModels();
    },
    openDownloadModal: (query) => {
      modelModal = {
        downloads: [],
        mode: "download",
        query,
        searchQuery: "",
        progress: 0,
        error: null,
      };
      notify();
    },
    classifyForRouting,
    runWorker,
  });

  turnCoordinator = createTurnCoordinator({
    isShuttingDown: () => isShuttingDown,
    isModelDeletionPending: () => modelManager.isModelDeletionPending(),
    isSessionOperation,
    isCommandRunning: () => commandRunning,
    isGenerating,
    isRouting,
    getActiveSession,
    onQuit,
    addMessage,
    updateDraft,
    sessionChanged,
    handleCommand: (text) => commandHandler.handle(text),
    setLastTurnInterrupted: (value) => sessionController.setLastTurnInterrupted(value),
    saveCurrentSession,
    setSessionError,
    notify: () => {
      if (status === "Stopping…" && !turnCoordinator.isTurnRunning()) {
        status = "Ready";
      }
      notify();
    },
  });

  function downloadSelectedModel(uri, fileName) {
    return modelManager.downloadModel(uri, fileName);
  }

  function blockDuringCompletionSave(action, blockedResult) {
    return async (...args) => {
      if (turnCoordinator.isCompletionSaving() && !isShuttingDown) {
        addMessage({
          type: "system",
          message: "Stop active generation or downloads before switching sessions.",
          severity: "warning",
        });
        return blockedResult;
      }
      return action(...args);
    };
  }

  return {
    getState,
    saveSession: (name) => saveCurrentSession({ name, force: true }),
    flushSessions: sessionStore.flush,
    startNewSession: blockDuringCompletionSave(startNewSession),
    openSessionPicker: blockDuringCompletionSave(openSessionPicker),
    closeSessionPicker,
    restoreSession: blockDuringCompletionSave(restoreSession),
    deleteSession: blockDuringCompletionSave(deleteSession, false),
    renameSession: blockDuringCompletionSave(renameSession, false),
    updateDraft,
    closeModelModal,
    openProviderModal,
    closeProviderModal,
    providerAction,
    ...chooserActions,
    ...(chooserActions.setSingleModel && {
      async setSingleModel(assignment) {
        if (isShuttingDown || changingSingleModel) return;
        if (modelManager.isModelDeletionPending()) {
          addMessage({
            type: "system",
            severity: "warning",
            message: "Wait for local model deletion to finish.",
          });
          return;
        }
        changingSingleModel = true;
        try {
          return await chooserActions.setSingleModel(assignment);
        } finally {
          changingSingleModel = false;
        }
      },
    }),
    refreshRouterWorkerModels: loadRouterWorkerModels,
    ...(appPolicy.canDeleteLocalModels && {
      deleteModel(model) {
        if (isShuttingDown || modelDeletion) return;
        modelDeletion = modelManager
          .deleteModel(model)
          .then((result) => {
            if (result.clearedSingleModel || result.deleted)
              updateStatus(appPolicy.initialStatus(configStore));
            return result;
          })
          .finally(() => {
            modelDeletion = undefined;
          });
        return modelDeletion;
      },
    }),
    searchHuggingFace: modelManager.searchHuggingFace,
    downloadSelectedModel,
    cancelModelDownload: modelManager.cancelModelDownload,
    initialize,
    submit(raw) {
      return turnCoordinator.submit(raw).catch((error) =>
        addMessage({
          type: "system",
          message: `Command failed: ${error.message}`,
          severity: "error",
        }),
      );
    },
    answerQuestions: questionRequest.respond,
    removeQueuedMessage: turnCoordinator.removeQueuedMessage,
    stopGeneration,
    shutdown,
  };
}
