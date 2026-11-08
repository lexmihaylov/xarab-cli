import {
  findText,
  readWorkspaceText,
  replaceWorkspaceText,
  resolveWorkspaceFile,
} from "../../../utils/workspace-file-utils.js";
import { formatChangePreview } from "../../../utils/change-diff.js";
import { formatMismatchDiagnostics } from "./mismatch-diagnostics.js";

export function createEditTool({ workspace = process.cwd(), onEvent = () => {} } = {}) {
  return {
    description:
      "Replace text in an existing workspace file. Read the file first; copy a short, distinctive oldString exactly, including whitespace. Add context only if needed for uniqueness. oldString must match exactly once unless replaceAll is true; use replaceAll only when every occurrence should change. newString replaces the entire oldString, including any context. Matching tolerates CRLF/LF differences, but newString is inserted as supplied. On mismatch, reread and use the diagnostics; no fuzzy edit is applied. Paths must stay within the workspace; symlinks and non-text files are rejected.",
    params: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the existing text file." },
        oldString: {
          type: "string",
          description:
            "Exact text to replace, including whitespace. Start with a short unique excerpt and add context if needed; it must match once unless replaceAll is true.",
        },
        newString: {
          type: "string",
          description: "Replacement for the entire oldString, including any context.",
        },
        replaceAll: {
          type: "boolean",
          description: "When true, replace every exact occurrence of oldString; defaults to false.",
        },
      },
      required: ["path", "oldString", "newString"],
    },
    async handler({ path: requestedPath, oldString, newString, replaceAll = false } = {}) {
      if (typeof requestedPath !== "string" || !requestedPath.trim())
        return "Error: provide a non-empty file path.";
      if (typeof oldString !== "string" || !oldString)
        return "Error: oldString must be a non-empty string.";
      if (typeof newString !== "string") return "Error: newString must be a string.";
      if (oldString.includes("\0") || newString.includes("\0"))
        return "Error: binary text is not supported.";
      if (oldString === newString) return "Error: oldString and newString must differ.";
      if (typeof replaceAll !== "boolean") return "Error: replaceAll must be a boolean.";

      let displayPath = requestedPath;
      try {
        const targetInfo = await resolveWorkspaceFile(workspace, requestedPath);
        displayPath = targetInfo.displayPath;
        if (!targetInfo.exists) return `Error: file does not exist: ${displayPath}.`;
        const original = await readWorkspaceText(targetInfo.target, displayPath);
        const matches = [];
        let searchFrom = 0;
        while (searchFrom <= original.length) {
          const match = findText(original.slice(searchFrom), oldString);
          if (!match) break;
          matches.push({ index: searchFrom + match.index, length: match.length });
          searchFrom += match.index + Math.max(match.length, 1);
        }
        const occurrences = matches.length;
        if (occurrences === 0)
          return `Error: oldString was not found in ${displayPath}; reread the file and provide the exact text.${formatMismatchDiagnostics(original, oldString, matches)}`;
        if (!replaceAll && occurrences !== 1) {
          return `Error: oldString must match exactly once in ${displayPath} (found ${occurrences}); add more surrounding text or set replaceAll: true.${formatMismatchDiagnostics(original, oldString, matches)}`;
        }
        const selected = replaceAll ? matches : matches.slice(0, 1);
        let updated = original;
        for (let index = selected.length - 1; index >= 0; index -= 1) {
          const match = selected[index];
          updated = `${updated.slice(0, match.index)}${newString}${updated.slice(match.index + match.length)}`;
        }
        await replaceWorkspaceText(targetInfo.target, updated, targetInfo.mode);
        onEvent({
          type: "edited",
          path: displayPath,
          replacements: replaceAll ? occurrences : 1,
          ...formatChangePreview(displayPath, original, updated),
        });
        return `Edited ${displayPath} (${replaceAll ? occurrences : 1} replacement${occurrences === 1 ? "" : "s"}).`;
      } catch (error) {
        const denied = /outside the workspace|resolves outside the workspace|Symbolic-link/.test(
          error.message,
        );
        onEvent({ type: denied ? "denied" : "error", path: displayPath, message: error.message });
        return `Error: editing ${displayPath}: ${error.code === "ENOENT" ? "file or parent directory does not exist" : error.message}`;
      }
    },
  };
}
