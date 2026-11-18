import { readFileSync } from "node:fs";
import { buildSystemPrompt } from "./instructions.js";

const tierAdjustmentInstructions = readFileSync(
  new URL("../instructions/tier-adjustment.md", import.meta.url),
  "utf8",
);

export function systemPromptFor({
  workspace,
  instructionFiles,
  tier,
  tierAdjustmentTool,
  definitions,
  delegated = false,
}) {
  const toolDescriptions = Object.entries(definitions).map(([name, definition]) => ({
    name,
    description: definition.description,
  }));
  const prompt = buildSystemPrompt({
    workspace,
    instructionFiles,
    delegated,
    availableTools: [
      ...toolDescriptions,
      ...(tierAdjustmentTool
        ? [{ name: "tier_adjustment", description: tierAdjustmentTool.description }]
        : []),
    ],
  });
  if (!tierAdjustmentTool) return prompt;
  return `${prompt}\n\n${tierAdjustmentInstructions.replace("{{tier}}", String(tier))}`;
}
