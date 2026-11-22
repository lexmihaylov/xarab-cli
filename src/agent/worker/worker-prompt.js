import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { buildSystemPrompt } from "./instructions.js";

const tierAdjustmentInstructions = Handlebars.compile(
  readFileSync(new URL("../instructions/tier-adjustment.md", import.meta.url), "utf8"),
  { noEscape: true },
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
    delegation: !delegated && Object.hasOwn(definitions, "task"),
    availableTools: [
      ...toolDescriptions,
      ...(tierAdjustmentTool
        ? [{ name: "tier_adjustment", description: tierAdjustmentTool.description }]
        : []),
    ],
  });
  return [prompt, tierAdjustmentTool ? tierAdjustmentInstructions({ tier: String(tier) }) : null]
    .filter(Boolean)
    .join("\n\n");
}
