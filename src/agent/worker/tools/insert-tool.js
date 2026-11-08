import {
  findText,
  readWorkspaceText,
  replaceWorkspaceText,
  resolveWorkspaceFile,
} from "../../../utils/workspace-file-utils.js";
import { formatChangePreview } from "../../../utils/change-diff.js";
import { formatMismatchDiagnostics } from "./mismatch-diagnostics.js";

export function createInsertTool({ workspace = process.cwd(), onEvent = () => {}, position }) {
  if (position !== "before" && position !== "after")
    throw new Error("position must be before or after");
  const name = position === "before" ? "insert_before" : "insert_after";
  const direction = position === "before" ? "before" : "after";

  return {
    description: `Insert text ${direction} the entire anchor in an existing workspace file. Read the file first and copy a short, distinctive anchor exactly, including whitespace; add context only if needed for uniqueness. The anchor must match exactly once. Context is part of the anchor: insertion occurs at its ${position === "before" ? "start" : "end"}, not at a line inside it. At a line boundary the tool adds a missing newline between content and anchor; for inline insertion supply any needed newlines explicitly. Matching tolerates CRLF/LF differences, but content is inserted as supplied. On mismatch, reread and use the diagnostics; no fuzzy insertion is applied. Paths must stay within the workspace; symlinks and non-text files are rejected.`,
    params: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the existing text file." },
        anchor: {
          type: "string",
          description:
            "Exact non-empty anchor, including whitespace. Start with a short unique excerpt; add context if needed. Insertion is relative to the entire anchor.",
        },
        content: { type: "string", description: `Text to insert ${direction} the entire anchor.` },
      },
      required: ["path", "anchor", "content"],
    },
    async handler({ path: requestedPath, anchor, content } = {}) {
      if (typeof requestedPath !== "string" || !requestedPath.trim())
        return "Error: provide a non-empty file path.";
      if (typeof anchor !== "string" || !anchor) return "Error: anchor must be a non-empty string.";
      if (typeof content !== "string" || !content)
        return "Error: content must be a non-empty string.";
      if (anchor.includes("\0") || content.includes("\0"))
        return "Error: binary text is not supported.";

      let displayPath = requestedPath;
      try {
        const targetInfo = await resolveWorkspaceFile(workspace, requestedPath);
        displayPath = targetInfo.displayPath;
        if (!targetInfo.exists) return `Error: file does not exist: ${displayPath}.`;
        const original = await readWorkspaceText(targetInfo.target, displayPath);
        const matches = [];
        let searchFrom = 0;
        while (searchFrom <= original.length) {
          const match = findText(original.slice(searchFrom), anchor);
          if (!match) break;
          matches.push({ index: searchFrom + match.index, length: match.length });
          searchFrom += match.index + Math.max(match.length, 1);
        }
        const occurrences = matches.length;
        if (occurrences === 0)
          return `Error: anchor was not found in ${displayPath}; reread the file and copy the exact text.${formatMismatchDiagnostics(original, anchor, matches)}`;
        if (occurrences !== 1) {
          return `Error: anchor must match exactly once in ${displayPath} (found ${occurrences}); include more surrounding text.${formatMismatchDiagnostics(original, anchor, matches)}`;
        }

        const match = matches[0];
        const insertionPoint = position === "before" ? match.index : match.index + match.length;
        const newline = original.includes("\r\n") ? "\r\n" : "\n";
        let inserted = content;
        if (
          position === "before" &&
          (match.index === 0 || /\r?\n$/.test(original.slice(0, match.index)))
        ) {
          if (!inserted.endsWith("\n")) inserted += newline;
        } else if (
          position === "after" &&
          (insertionPoint === original.length || /^\r?\n/.test(original.slice(insertionPoint)))
        ) {
          if (!inserted.startsWith("\n")) inserted = `${newline}${inserted}`;
        }
        const updated = `${original.slice(0, insertionPoint)}${inserted}${original.slice(insertionPoint)}`;
        await replaceWorkspaceText(targetInfo.target, updated, targetInfo.mode);
        onEvent({
          type: "edited",
          path: displayPath,
          action: `Inserted ${direction}`,
          replacements: 1,
          ...formatChangePreview(displayPath, original, updated),
        });
        return `Inserted ${direction} anchor in ${displayPath}.`;
      } catch (error) {
        const denied = /outside the workspace|resolves outside the workspace|Symbolic-link/.test(
          error.message,
        );
        onEvent({ type: denied ? "denied" : "error", path: displayPath, message: error.message });
        return `Error ${name} ${displayPath}: ${error.code === "ENOENT" ? "file or parent directory does not exist" : error.message}`;
      }
    },
  };
}
