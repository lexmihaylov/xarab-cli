export const help =
  "Commands: /help, /new [name], /sessions, /save [name], /model, /connect, /download [query], /compact, /clear, /exit.\nUse /model to choose one local or remote model. Use /connect for providers and /download to search Hugging Face.\nSessions autosave; Ctrl+O opens the session browser. Prefix shell commands with !.\nEnter sends; Shift+Enter/Ctrl+N adds a line; PgUp/PgDn scroll; Esc stops generation.";

export function handleModeCommand(text, { openModelChooser, openDownloadModal, addMessage }) {
  if (text === "/model") return { handled: true, value: openModelChooser() };
  if (text === "/download" || text.startsWith("/download "))
    return { handled: true, value: openDownloadModal(text.slice("/download".length).trim()) };
  if (text === "/route")
    return {
      handled: true,
      value: addMessage({
        type: "system",
        severity: "warning",
        message: "Command not available in single mode. Use /help for available commands.",
      }),
    };
  return { handled: false };
}

export function dispatch(text, { routeMessage }) {
  return routeMessage(text);
}
