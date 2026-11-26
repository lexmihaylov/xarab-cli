import { lstat, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  isWithinDirectory,
  readWorkspaceText,
  replaceWorkspaceText,
  resolveWorkspaceFile,
} from "../../../utils/workspace-file-utils.js";
import { formatChangePreview } from "../../../utils/change-diff.js";

export function parsePatch(patch) {
  if (typeof patch !== "string" || patch.includes("\0")) {
    throw new Error("patch must be UTF-8 text without NUL characters.");
  }
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch") {
    throw new Error("patch must begin with *** Begin Patch and end with *** End Patch.");
  }
  const operations = [];
  let i = 0;
  while (i < lines.length) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines[i++]);
    if (!header || !header[2].trim()) throw new Error("invalid file header in patch.");
    const operation = { kind: header[1], path: header[2], lines: [] };
    while (i < lines.length && !lines[i].startsWith("*** ")) {
      operation.lines.push(lines[i++]);
    }
    if (operation.kind === "Add") {
      if (operation.lines.some((line) => !line.startsWith("+"))) {
        throw new Error(`invalid Add File content: ${operation.path}.`);
      }
    } else if (operation.kind === "Delete") {
      if (operation.lines.length)
        throw new Error(`invalid Delete File content: ${operation.path}.`);
    } else {
      // End-of-file markers are part of the preceding hunk, not file headers.
      while (lines[i] === "*** End of File") {
        operation.lines.push(lines[i++]);
        while (i < lines.length && !lines[i].startsWith("*** ")) operation.lines.push(lines[i++]);
      }
      if (!operation.lines.length) throw new Error(`missing update hunk: ${operation.path}.`);
    }
    operations.push(operation);
  }
  if (!operations.length) throw new Error("patch contains no files.");
  return operations;
}

function applyUpdate(original, operation) {
  const source = Array.from(original.matchAll(/([^\n]*?)(\r\n|\n|$)/g), ([, text, ending]) => ({
    text,
    ending,
  }));
  if (source.at(-1)?.text === "" && source.at(-1)?.ending === "") source.pop();
  let cursor = 0;
  let i = 0;
  let hunks = 0;
  while (i < operation.lines.length) {
    const marker = operation.lines[i++];
    if (marker !== "@@" && !marker.startsWith("@@ ")) {
      throw new Error(`expected @@ hunk in ${operation.path}.`);
    }
    if (marker.startsWith("@@ ")) {
      const anchor = source.findIndex((line, index) => index >= cursor && line.text === marker.slice(3));
      if (anchor < 0) throw new Error(`hunk anchor not found in ${operation.path}.`);
      cursor = anchor + 1;
    }
    const before = [];
    const edits = [];
    let changed = false;
    while (
      i < operation.lines.length &&
      !operation.lines[i].startsWith("@@") &&
      operation.lines[i] !== "*** End of File"
    ) {
      const line = operation.lines[i++];
      if (![" ", "+", "-"].includes(line[0]))
        throw new Error(`invalid hunk line in ${operation.path}.`);
      if (line[0] !== "+") before.push(line.slice(1));
      edits.push({ kind: line[0], text: line.slice(1) });
      if (line[0] !== " ") changed = true;
    }
    if (!changed) throw new Error(`empty hunk in ${operation.path}.`);
    const endOnly = operation.lines[i] === "*** End of File";
    if (endOnly) i++;
    let found = -1;
    for (let at = cursor; at <= source.length - before.length; at++) {
      if (endOnly && at + before.length !== source.length) continue;
      if (before.every((line, index) => source[at + index].text === line)) {
        found = at;
        break;
      }
    }
    if (found < 0)
      throw new Error(`hunk does not match ${operation.path}; no fuzzy matching is used.`);
    const removed = source.slice(found, found + before.length);
    const ending =
      removed.find((line) => line.ending)?.ending ||
      source[found - 1]?.ending ||
      source.slice(found + before.length).find((line) => line.ending)?.ending ||
      "\n";
    const replacesUnterminatedEnd =
      found + before.length === source.length && source.at(-1)?.ending === "";
    const after = [];
    let oldIndex = 0;
    for (const edit of edits) {
      if (edit.kind === " ") after.push(removed[oldIndex++]);
      else if (edit.kind === "-") oldIndex++;
      else after.push({ text: edit.text, ending });
    }
    if (replacesUnterminatedEnd && after.length && edits.at(-1)?.kind === "+") {
      after.at(-1).ending = "";
    }
    source.splice(found, before.length, ...after);
    // An insertion after an unterminated line needs a separator before the new line.
    for (let index = 0; index < source.length - 1; index++) {
      if (!source[index].ending) source[index].ending = ending;
    }
    cursor = found + after.length;
    hunks++;
  }
  if (!hunks) throw new Error(`missing update hunk: ${operation.path}.`);
  return source.map((line) => line.text + line.ending).join("");
}

// Resolve existing ancestors without creating directories during validation.
async function resolveForValidation(workspace, requestedPath) {
  const root = await realpath(path.resolve(workspace));
  const candidate = path.resolve(root, requestedPath);
  if (!isWithinDirectory(root, candidate)) throw new Error("File path is outside the workspace.");
  if (candidate === root) throw new Error("Path is not a regular file.");
  let parent = root;
  let missing = false;
  for (const segment of path
    .relative(root, path.dirname(candidate))
    .split(path.sep)
    .filter(Boolean)) {
    parent = path.join(parent, segment);
    if (!missing) {
      try {
        parent = await realpath(parent);
        if (!isWithinDirectory(root, parent))
          throw new Error("File path resolves outside the workspace.");
        if (!(await stat(parent)).isDirectory()) throw new Error("Parent path is not a directory.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        // A dangling symlink must not be treated as a missing directory.
        try {
          await lstat(parent);
        } catch (entryError) {
          if (entryError.code !== "ENOENT") throw entryError;
          missing = true;
          continue;
        }
        throw new Error("Symbolic-link parent is not supported.");
      }
    }
  }
  if (!missing) return resolveWorkspaceFile(workspace, requestedPath);
  return {
    target: path.join(parent, path.basename(candidate)),
    displayPath: path.relative(root, path.join(parent, path.basename(candidate))),
    exists: false,
  };
}

export function createApplyPatchTool({ workspace = process.cwd(), onEvent = () => {} } = {}) {
  return {
    description:
      "Apply a *** Begin Patch patch containing *** Add File: path, *** Update File: path, and *** Delete File: path sections, ending with *** End Patch. Add File lines begin with +. Each Update File hunk starts with @@ or @@ anchor, followed by context lines prefixed with a space, removed lines with -, and added lines with +. Context must match exactly; all sections are validated before changes. Paths must stay within the workspace. If an I/O error occurs during application, earlier changes may remain.",
    params: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Complete *** Begin Patch formatted patch." },
      },
      required: ["patch"],
    },
    async handler({ patch } = {}) {
      let currentPath = "";
      const completed = [];
      try {
        const operations = parsePatch(patch);
        const targets = new Set();
        for (const operation of operations) {
          currentPath = operation.path;
          const info = await resolveForValidation(workspace, operation.path);
          if (targets.has(info.target)) throw new Error(`duplicate target: ${info.displayPath}.`);
          targets.add(info.target);
          if (operation.kind === "Add" && info.exists)
            throw new Error(`file already exists: ${info.displayPath}.`);
          if (operation.kind !== "Add" && !info.exists)
            throw new Error(`file does not exist: ${info.displayPath}.`);
          const original = info.exists
            ? await readWorkspaceText(info.target, info.displayPath)
            : "";
          const updated =
            operation.kind === "Add"
              ? operation.lines.map((line) => line.slice(1)).join("\n") +
                (operation.lines.length ? "\n" : "")
              : operation.kind === "Delete"
                ? ""
                : applyUpdate(original, operation);
          Object.assign(operation, { info, original, updated });
        }
        for (const operation of operations) {
          currentPath = operation.path;
          const info = await resolveWorkspaceFile(workspace, operation.path, {
            createParents: operation.kind === "Add",
          });
          if (info.target !== operation.info.target || info.exists !== operation.info.exists)
            throw new Error("target changed since validation.");
          if (
            info.exists &&
            (await readWorkspaceText(info.target, info.displayPath)) !== operation.original
          )
            throw new Error("file changed since validation.");
          if (operation.kind === "Delete") await unlink(info.target);
          else await replaceWorkspaceText(info.target, operation.updated, info.mode);
          completed.push(info.displayPath);
          onEvent({
            type:
              operation.kind === "Add"
                ? "written"
                : operation.kind === "Delete"
                  ? "deleted"
                  : "edited",
            path: info.displayPath,
            created: operation.kind === "Add",
            ...formatChangePreview(info.displayPath, operation.original, operation.updated),
          });
        }
        return `Applied patch to ${completed.length} file(s): ${completed.join(", ")}.`;
      } catch (error) {
        const message = error.message || String(error);
        onEvent({
          type: /outside the workspace|Symbolic-link/.test(message) ? "denied" : "error",
          path: currentPath,
          message,
        });
        return {
          ok: false,
          output: `Error applying patch${currentPath ? ` at ${currentPath}` : ""}: ${message}${completed.length ? ` Already applied: ${completed.join(", ")}.` : " No files applied."}`,
        };
      }
    },
  };
}
