import React from "react";
import { Composer as ComposerShell, commandOptions } from "../../components/Composer.component.jsx";

const singleCommands = [
  ...commandOptions.slice(0, 3),
  { command: "/download", description: "Search Hugging Face for models" },
  ...commandOptions.slice(3),
  { command: "/model", description: "Choose a model" },
];

export function Composer(props) {
  return <ComposerShell {...props} availableCommands={singleCommands} />;
}
