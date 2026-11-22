import React from "react";
import { Composer as ComposerShell, commandOptions } from "../components/Composer.component.jsx";

const tieredCommands = [
  commandOptions[0],
  { command: "/route", description: "Configure router and tier workers" },
  ...commandOptions.slice(1),
];

export function Composer(props) {
  return <ComposerShell {...props} availableCommands={tieredCommands} />;
}
