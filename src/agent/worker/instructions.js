import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";

const MAX_FILE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 48_000;

export const BASE_SYSTEM_PROMPT = readFileSync(
  new URL("../instructions/main-agent.md", import.meta.url),
  "utf8",
);

const renderMainPrompt = Handlebars.compile(BASE_SYSTEM_PROMPT, { noEscape: true });

export const SUBTASK_SYSTEM_PROMPT = readFileSync(
  new URL("../instructions/task-agent.md", import.meta.url),
  "utf8",
);

export async function loadProjectInstructions(workspace = process.cwd()) {
  const directories = [];
  let current = path.resolve(workspace);
  while (true) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const files = [];
  let totalCharacters = 0;
  for (const directory of directories.reverse()) {
    const filePath = path.join(directory, "AGENTS.md");
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      continue;
    }

    const available = MAX_TOTAL_CHARS - totalCharacters;
    if (available <= 0) break;
    const boundedContent = content.slice(0, Math.min(MAX_FILE_CHARS, available)).trim();
    if (!boundedContent) continue;
    files.push({ path: filePath, content: boundedContent });
    totalCharacters += boundedContent.length;
  }
  return files;
}

export function buildSystemPrompt({
  workspace = process.cwd(),
  instructionFiles = [],
  availableTools = [],
  delegated = false,
  delegation = false,
} = {}) {
  const toolDescriptions = availableTools.map((tool) =>
    typeof tool === "string" ? `- ${tool}` : `- ${tool.name}: ${tool.description}`,
  );
  const sections = [
    `## Runtime context\nWorkspace: ${path.resolve(workspace)}\nUse the available tools listed below to perform work. The user may also run a local shell command by entering !<command>; its output may be included in their next message and is not a command you ran.\n\n## Available tools\n${toolDescriptions.length ? toolDescriptions.join("\n") : "- None are currently registered."}`,
  ];
  for (const file of instructionFiles) {
    sections.push(`## Project instructions: ${file.path}\n${file.content}`);
  }
  const context = sections.join("\n\n");
  return delegated
    ? [SUBTASK_SYSTEM_PROMPT, context].join("\n\n")
    : renderMainPrompt({ context, delegation });
}
