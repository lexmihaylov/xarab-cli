import { AsyncLocalStorage } from "node:async_hooks";
import { createToolTimelineObserver, toolProgressLabel } from "./tool-timeline-observer.js";
import { loadApprovedPolicy } from "../policy-consent.js";
import { authorizeNativeTool, isPolicyTool } from "../native-policy.js";
import { createAskQuestionsTool } from "./tools/ask-questions-tool.js";
import { createReadFileTool } from "./tools/read-file-tool.js";
import { createListFilesTool } from "./tools/list-files-tool.js";
import { createSearchFilesTool } from "./tools/search-files-tool.js";
import { createSearchContentTool } from "./tools/search-content-tool.js";
import { createEditTool } from "./tools/edit-tool.js";
import { createApplyPatchTool } from "./tools/apply-patch-tool.js";
import { createInsertTool } from "./tools/insert-tool.js";
import { createWriteTool } from "./tools/write-tool.js";
import { createWebsearchTool } from "./tools/web-search-tool.js";
import { createWebfetchTool } from "./tools/web-fetch-tool.js";
import { createShellTool } from "./tools/shell-tool.js";
import { createSkillTool } from "./tools/skill-tool.js";
import {
  createOpenAIImageEditTool,
  createOpenAIImageGenerationTool,
} from "./tools/openai-image-tool.js";
import { createOpenAIImageAnalysisTool } from "./tools/openai-image-analysis-tool.js";

export function createToolRegistry({
  workspace,
  skills = new Map(),
  externalTools = {},
  taskTool,
  assessCommand,
  configStore,
  imageCredentials,
  requestQuestions,
  onToolEvent,
  onDiagnosticEvent,
  getMessages,
  getCurrentAgentMessage,
  sessionChanged,
  notify,
}) {
  const callContext = new AsyncLocalStorage();
  const emitToolEvent = (name, event) => {
    const callId = callContext.getStore();
    onToolEvent(name, callId ? { ...event, callId } : event);
  };
  const definitions = {
    ...externalTools,
    ...(taskTool ? { task: taskTool } : {}),
    ...(requestQuestions ? { ask_questions: createAskQuestionsTool({ requestQuestions }) } : {}),
    read_file: createReadFileTool({
      workspace,
      onEvent: (event) => emitToolEvent("read_file", event),
    }),
    list_files: createListFilesTool({
      workspace,
      onEvent: (event) => emitToolEvent("list_files", event),
    }),
    search_files: createSearchFilesTool({
      workspace,
      onEvent: (event) => emitToolEvent("search_files", event),
    }),
    search_content: createSearchContentTool({
      workspace,
      onEvent: (event) => emitToolEvent("search_content", event),
    }),
    edit: createEditTool({ workspace, onEvent: (event) => emitToolEvent("edit", event) }),
    apply_patch: createApplyPatchTool({
      workspace,
      onEvent: (event) => emitToolEvent("apply_patch", event),
    }),
    insert_before: createInsertTool({
      workspace,
      position: "before",
      onEvent: (event) => emitToolEvent("insert_before", event),
    }),
    insert_after: createInsertTool({
      workspace,
      position: "after",
      onEvent: (event) => emitToolEvent("insert_after", event),
    }),
    write: createWriteTool({ workspace, onEvent: (event) => emitToolEvent("write", event) }),
    websearch: createWebsearchTool({
      getApiKey: () => process.env.TAVILY_API_KEY?.trim() || configStore.getApiKey("tavily"),
      onEvent: (event) => emitToolEvent("websearch", event),
    }),
    webfetch: createWebfetchTool({
      onEvent: (event) => emitToolEvent("webfetch", event),
    }),
    run_command: createShellTool({
      workspace,
      assessCommand,
      requestQuestions,
      onEvent: (event) => emitToolEvent("run_command", event),
    }),
    ...(skills.size ? { skill: createSkillTool(skills) } : {}),
    ...(imageCredentials
      ? {
          generate_image: createOpenAIImageGenerationTool({
            workspace,
            getCredentials: imageCredentials,
          }),
          edit_image: createOpenAIImageEditTool({
            workspace,
            getCredentials: imageCredentials,
          }),
          analyze_image: createOpenAIImageAnalysisTool({
            workspace,
            getCredentials: imageCredentials,
          }),
        }
      : {}),
  };

  const observer = createToolTimelineObserver({
    getMessages,
    getCurrentAgentMessage,
    sessionChanged,
    notify,
  });
  const tools = Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      {
        ...definition,
        async handler(params, { callId, signal } = {}) {
          const part = await observer.start(name, params, callId);
          onDiagnosticEvent?.(name, {
            type: "invoked",
            callId,
            label: toolProgressLabel(name, params),
          });
          try {
            if (signal?.aborted) throw signal.reason ?? new Error("Tool call cancelled.");
            if (isPolicyTool(name)) {
              const policy = await loadApprovedPolicy({ workspace, requestQuestions, signal });
              const approved = await authorizeNativeTool({
                policy,
                workspace,
                name,
                params,
                requestQuestions,
                signal,
              });
              if (!approved) throw new Error("Access denied or cancelled by workspace policy.");
            }
            const rawResult = await callContext.run(callId, () =>
              definition.handler(params, { signal, callId }),
            );
            const result = normalizeToolResult(rawResult);
            onDiagnosticEvent?.(name, { type: "finished", callId, ok: result.ok });
            observer.complete(part, name, params, result);
            return result;
          } catch (error) {
            onDiagnosticEvent?.(name, { type: "finished", callId, ok: false });
            const result = {
              ok: false,
              output: `Error: ${error?.message ?? String(error)}`,
              errorCode: error?.code,
            };
            observer.fail(part, result);
            return result;
          } finally {
            observer.finish();
          }
        },
      },
    ]),
  );

  return { definitions, tools };
}

function normalizeToolResult(result) {
  if (result && typeof result === "object" && typeof result.ok === "boolean") {
    return {
      ...result,
      output: String(result.output ?? ""),
    };
  }
  const serialized = typeof result === "string" ? result : JSON.stringify(result);
  const output = serialized === undefined ? String(result) : serialized;
  const failed = /^\s*(?:error|failed|failure)\s*:/i.test(output);
  return { ok: !failed, output };
}
