export function createTurnCoordinator({
  isShuttingDown,
  isModelDeletionPending,
  isSessionOperation,
  isCommandRunning,
  isGenerating,
  isRouting,
  getActiveSession,
  onQuit,
  addMessage,
  updateDraft,
  sessionChanged,
  handleCommand,
  setLastTurnInterrupted,
  saveCurrentSession,
  setSessionError,
  notify,
}) {
  let turn;
  let nextQueuedId = 0;
  let queuedMessages = [];

  async function submit(raw) {
    if (isShuttingDown()) {
      return;
    }
    const text = raw.trim();
    if (!text) {
      return;
    }
    if (text === "/exit") {
      return onQuit();
    }
    if (isModelDeletionPending()) {
      return addMessage({
        type: "system",
        severity: "warning",
        message: "Wait for local model deletion to finish.",
      });
    }
    if (
      isSessionOperation() ||
      isCommandRunning() ||
      ((turn || isGenerating() || isRouting()) && (text.startsWith("/") || text.startsWith("!")))
    ) {
      return addMessage({
        type: "system",
        message: "Wait for the current work to finish before running a command.",
        severity: "warning",
      });
    }
    const sessionId = getActiveSession().id;
    if (text === "/compact") {
      return runTurn(text, sessionId, { saveCompletion: false, prepare: clearDraft });
    }
    if (text.startsWith("/") || text.startsWith("!")) {
      clearDraft();
      return handleCommand(text);
    }
    if (
      turn ||
      isGenerating() ||
      isRouting() ||
      queuedMessages.some((item) => item.sessionId === sessionId)
    ) {
      queuedMessages.push({ id: ++nextQueuedId, text, sessionId });
      clearDraft();
      notify();
      return drainQueue(sessionId);
    }
    return runTurn(text, sessionId, { prepare: clearDraft });
  }

  function clearDraft() {
    updateDraft({ value: "", cursor: 0 });
    sessionChanged();
  }

  async function runTurn(text, sessionId, { saveCompletion = true, prepare } = {}) {
    let settle;
    const activeTurn = {
      done: new Promise((resolve) => {
        settle = resolve;
      }),
      interrupted: false,
      queuePaused: false,
      replyComplete: false,
      savingCompletion: false,
      saveCompletion,
    };
    turn = activeTurn;
    try {
      prepare?.();
      notify();
      if (!activeTurn.interrupted && !isShuttingDown()) {
        await handleCommand(text);
      }
      if (saveCompletion && !activeTurn.interrupted && !isShuttingDown()) {
        activeTurn.savingCompletion = true;
        markReplyComplete();
        sessionChanged();
        try {
          await saveCurrentSession();
        } catch (error) {
          setSessionError(`Session could not be saved: ${error.message}`);
          notify();
        }
      }
    } catch (error) {
      markInterrupted();
      throw error;
    } finally {
      turn = undefined;
      settle();
      notify();
    }
    if (!activeTurn.queuePaused && !activeTurn.interrupted && !isShuttingDown()) {
      await drainQueue(sessionId);
    }
  }

  async function drainQueue(sessionId) {
    if (
      turn ||
      isShuttingDown() ||
      isModelDeletionPending() ||
      isSessionOperation() ||
      isCommandRunning() ||
      isGenerating() ||
      isRouting() ||
      getActiveSession().id !== sessionId
    ) {
      return;
    }
    const index = queuedMessages.findIndex((item) => item.sessionId === sessionId);
    if (index < 0) {
      return;
    }
    const [item] = queuedMessages.splice(index, 1);
    await runTurn(item.text, sessionId);
  }

  function removeQueuedMessage(id) {
    queuedMessages = queuedMessages.filter((item) => item.id !== id);
    notify();
  }

  function pauseQueue() {
    if (turn) {
      turn.queuePaused = true;
    }
  }

  function markReplyComplete() {
    if (turn?.saveCompletion && !turn.interrupted && !turn.replyComplete) {
      turn.replyComplete = true;
      setLastTurnInterrupted(false);
      sessionChanged();
    }
  }

  function markInterrupted() {
    if (turn && !turn.interrupted && !turn.replyComplete) {
      turn.interrupted = true;
      if (turn.saveCompletion) {
        setLastTurnInterrupted(true);
        sessionChanged();
      }
    }
  }

  return {
    submit,
    removeQueuedMessage,
    isTurnRunning: () => Boolean(turn),
    isCompletionSaving: () => turn?.savingCompletion ?? false,
    isTurnInterrupted: () => turn?.interrupted ?? false,
    isReplyComplete: () => turn?.replyComplete ?? false,
    whenIdle: () => turn?.done,
    pauseQueue,
    markReplyComplete,
    markInterrupted,
    getQueuedMessages: (sessionId) => queuedMessages.filter((item) => item.sessionId === sessionId),
  };
}
