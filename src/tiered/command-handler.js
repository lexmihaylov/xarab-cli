export const help =
  "Commands: /help, /new [name], /sessions, /save [name], /route, /connect, /compact, /clear, /exit.\nUse /route to configure remote router and tier workers; /connect connects providers.\nSessions autosave; Ctrl+O opens the session browser. Prefix shell commands with !.\nEnter sends; Shift+Enter/Ctrl+N adds a line; PgUp/PgDn scroll; Esc stops generation.";
export function handleModeCommand(text, { openModelChooser, openRouteModelModal, addMessage }) {
  if (text === "/route")
    return { handled: true, value: (openModelChooser ?? openRouteModelModal)() };
  if (text === "/model" || text === "/download" || text.startsWith("/download "))
    return {
      handled: true,
      value: addMessage({
        type: "system",
        severity: "warning",
        message: "Command not available in tiered mode. Use /help for available commands.",
      }),
    };
  return { handled: false };
}

export async function dispatch(text, { addMessage, classifyForRouting, notify, runWorker }) {
  const userMessage = addMessage({
    type: "user",
    message: text,
    classification: { status: "classifying" },
  });
  let route;
  try {
    route = await classifyForRouting(text);
  } catch (error) {
    userMessage.classification = { status: "error" };
    notify();
    throw error;
  }
  if (route?.cancelled) {
    userMessage.classification = { status: "cancelled" };
    notify();
    return;
  }
  if (!route) {
    userMessage.classification = { status: "error" };
    notify();
    return addMessage({
      type: "system",
      message: "Configure a router and tier worker with /route before chatting.",
      severity: "warning",
    });
  }
  const { classification, worker } = route;
  if (!worker) {
    userMessage.classification = { status: "error" };
    notify();
    throw new Error(`No worker is configured for Tier ${classification.tier}.`);
  }
  if (!worker.configured) {
    userMessage.classification = { status: "error" };
    notify();
    throw new Error("Tier worker configuration is invalid; choose a model in /route.");
  }
  userMessage.classification = {
    status: "done",
    tier: classification.tier,
    model: worker.model,
    confidence: classification.confidence,
    rationale: classification.rationale,
  };
  notify();
  return runWorker(text, {
    tier: classification.tier,
    userMessage,
  });
}
