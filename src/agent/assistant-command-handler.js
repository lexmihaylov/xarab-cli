import { resolveAppPolicy } from "./app-policy.js";
import { logoutMcpOAuth } from "./worker/mcp-oauth.js";
import { runShellCommand } from "./worker/tools/shell-command-executor.js";
import {
  appendShellContext,
  createShellContextEntry,
  formatShellResult,
} from "../utils/shell-context.js";

export function createCommandHandler({
  workspace,
  mode,
  commandPolicy = resolveAppPolicy(mode).commands,
  routeMessage,
  openModelChooser,
  addMessage,
  updateStatus,
  notify,
  getPendingShellContext,
  setPendingShellContext,
  sessionChanged,
  isGenerating,
  isRouting,
  getCommandRunning,
  setCommandRunning,
  openSessionPicker,
  startNewSession,
  saveCurrentSession,
  getActiveSession,
  compactSession,
  openRouteModelModal,
  openDownloadModal,
  openProviderModal,
  classifyForRouting,
  runWorker,
}) {
  if (
    !commandPolicy ||
    typeof commandPolicy.help !== "string" ||
    typeof commandPolicy.handleModeCommand !== "function" ||
    typeof commandPolicy.dispatch !== "function"
  )
    throw new Error("A valid command policy or application mode is required.");

  async function runUserCommand(command) {
    if (!command.trim())
      return addMessage({
        type: "system",
        message: "Use ! followed by a shell command, for example: !git status",
        severity: "warning",
      });
    if (isGenerating() || isRouting() || getCommandRunning())
      return addMessage({
        type: "system",
        message: "Wait for the current work to finish before running a shell command.",
        severity: "warning",
      });

    setCommandRunning(true);
    updateStatus("Running command…");
    const shellMessage = addMessage({ type: "shell", command, message: "", running: true });
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const result = await runShellCommand(command, { cwd: workspace });
      shellMessage.message = formatShellResult(command, result, workspace);
      shellMessage.severity =
        result.timedOut || result.error ? "error" : result.code === 0 ? "info" : "warning";
      delete shellMessage.running;
      setPendingShellContext(
        appendShellContext(getPendingShellContext(), createShellContextEntry(command, result)),
      );
      sessionChanged();
      notify();
    } finally {
      setCommandRunning(false);
      updateStatus("Ready");
    }
  }

  async function handle(text) {
    if (text.startsWith("!")) return runUserCommand(text.slice(1));
    if (text === "/compact") return compactSession();
    if (text === "/exit") return undefined;
    if (text === "/help") {
      addMessage({
        type: "system",
        message: commandPolicy.help,
      });
      return;
    }
    if (text === "/mcp logout") {
      if (isGenerating() || isRouting()) {
        addMessage({
          type: "system",
          message: "Stop the active request before signing out of MCP servers.",
          severity: "warning",
        });
        return;
      }
      await logoutMcpOAuth();
      addMessage({
        type: "system",
        message:
          "Removed stored OAuth credentials for all MCP servers. This does not revoke tokens at the provider.",
        severity: "info",
      });
      return;
    }
    if (text === "/sessions") return openSessionPicker();
    if (text === "/new" || text.startsWith("/new ")) return startNewSession(text.slice(4).trim());
    if (text === "/save" || text.startsWith("/save ")) {
      const saved = await saveCurrentSession({
        name: text.slice(5).trim() || undefined,
        force: true,
      });
      updateStatus(
        saved
          ? `Session saved: ${getActiveSession().title}`
          : "Session will be saved with your first message",
      );
      return;
    }
    if (text === "/clear") {
      if (!(await startNewSession())) return;
      addMessage({
        type: "system",
        message: "Conversation cleared. System and project instructions remain active.",
      });
      return;
    }
    if (text === "/connect") return openProviderModal();
    const command = commandPolicy.handleModeCommand(text, {
      openModelChooser,
      openRouteModelModal,
      openDownloadModal,
      addMessage,
    });
    if (command.handled) return command.value;
    return commandPolicy.dispatch(text, {
      routeMessage,
      addMessage,
      classifyForRouting,
      notify,
      runWorker,
    });
  }

  return { handle };
}
