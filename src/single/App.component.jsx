import React from "react";
import { ChatShell } from "../ChatShell.component.jsx";
import { Composer } from "./Composer.component.jsx";
import { SingleModelChooser } from "./SingleModelChooser.component.jsx";
import { ModelDownloader } from "./ModelDownloader.component.jsx";

const welcomeCommands = [
  ["/connect", "Connect a provider"],
  ["/model", "Choose a model"],
  ["/download", "Find local models"],
  ["/sessions", "Browse saved sessions"],
  ["/clear", "Clear the conversation"],
  ["/new", "Start a new session"],
  ["!command", "Run a shell command"],
];

export function App(props) {
  const { state } = props;
  let modelDialog = null;
  if (state.modelModal?.mode === "chooser") {
    modelDialog = (
      <SingleModelChooser
        {...state.modelModal}
        singleModel={state.singleModel}
        onClose={props.onCloseModelModal}
        onSetSingleModel={props.onSetSingleModel}
        onSetModelContextSize={props.onSetModelContextSize}
        onDeleteModel={props.onDeleteModel}
        onRefreshWorkerModels={props.onRefreshRouterWorkerModels}
      />
    );
  } else if (state.modelModal?.mode === "download") {
    modelDialog = (
      <ModelDownloader
        {...state.modelModal}
        onClose={props.onCloseModelModal}
        onDownloadSelected={props.onDownloadSelectedModel}
        onCancelDownload={props.onCancelModelDownload}
        onSearch={props.onSearchHuggingFace}
      />
    );
  }
  return (
    <ChatShell
      {...props}
      welcomeCommands={welcomeCommands}
      modelCommand="/model"
      Composer={Composer}
      modelDialog={modelDialog}
    />
  );
}
