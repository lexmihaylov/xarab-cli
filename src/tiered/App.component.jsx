import React from "react";
import { ChatShell } from "../ChatShell.component.jsx";
import { Composer } from "./Composer.component.jsx";
import { ModelChooser } from "./ModelChooser.component.jsx";

const welcomeCommands = [
  ["/connect", "Connect a provider"],
  ["/route", "Set up routing and workers"],
  ["/sessions", "Browse saved sessions"],
  ["/clear", "Clear the conversation"],
  ["/new", "Start a new session"],
  ["!command", "Run a shell command"],
];

export function App(props) {
  const { state } = props;
  const modelDialog = state.modelModal?.mode === "chooser" && (
    <ModelChooser
      {...state.modelModal}
      onClose={props.onCloseModelModal}
      onSetClassifier={props.onSetRouterClassifier}
      onSetTierWorker={props.onSetRouterTierWorker}
      onRefreshWorkerModels={props.onRefreshRouterWorkerModels}
      onOpenProviders={props.onOpenProviders}
    />
  );
  return (
    <ChatShell
      {...props}
      welcomeCommands={welcomeCommands}
      modelCommand="/route"
      Composer={Composer}
      modelDialog={modelDialog}
    />
  );
}
