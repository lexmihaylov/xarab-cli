import { lstatSync, realpathSync, unlinkSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { searchHuggingFaceModels } from "../utils/huggingface-model-search.js";

export function createModelManager({
  modelsDir,
  configStore,
  downloadFile,
  notify,
  addMessage,
  getModelModal,
  setModelModal,
  getActiveDownload,
  setActiveDownload,
  getNextDownloadId,
  setNextDownloadId,
  appMode,
  isLocalModelInUse,
  unloadLocalRuntime,
}) {
  const deletionScope = Symbol("local model deletion");
  let deletionPending = false;

  async function listModelPaths() {
    const entries = await readdir(modelsDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".gguf"))
      .map((entry) => path.join(modelsDir, entry.name));
  }

  async function listModels() {
    const paths = await listModelPaths();
    return paths.map((id) => ({
      provider: "local",
      id,
      name: configStore.getModel(id)?.name?.trim() || path.basename(id),
    }));
  }

  function getModelSettings(models) {
    return Object.fromEntries(models.map(({ id }) => [id, configStore.getModel(id)]));
  }

  async function deleteModel(modelToDelete) {
    const modal = getModelModal?.();
    if (modal?.mode !== "chooser")
      return { deleted: false, error: "Open the model chooser first." };
    if (deletionPending)
      return { deleted: false, error: "A model deletion is already in progress." };
    function reject(error) {
      setModelModal({ ...modal, error });
      notify();
      return { deleted: false, error };
    }
    if (appMode !== "single") return reject("Local model deletion is only available in xarab-one.");
    if (
      typeof isLocalModelInUse !== "function" ||
      typeof configStore.removeDeletedLocalModel !== "function"
    )
      return reject("Local model deletion is not configured.");
    if (getActiveDownload?.()) return reject("Wait for the current model download to finish.");

    const root = path.resolve(modelsDir);
    const invalidPath = "Only local GGUF files directly in the models directory can be deleted.";
    if (
      typeof modelToDelete !== "string" ||
      modelToDelete.includes("\0") ||
      path.normalize(modelToDelete) !== modelToDelete ||
      !modelToDelete.endsWith(".gguf")
    )
      return reject(invalidPath);
    const resolved = path.resolve(modelToDelete);
    if (path.dirname(resolved) !== root) return reject(invalidPath);

    // Provider refreshes spread the current modal; freshly opened modals do not inherit this token.
    const token = {};
    const currentChooser = () => {
      const current = getModelModal();
      return current?.mode === "chooser" && current[deletionScope] === token ? current : null;
    };
    deletionPending = true;
    let deleted = false;
    let clearedSingleModel = false;
    let error = null;
    let models;
    let modelSettings;
    try {
      setModelModal({ ...modal, [deletionScope]: token });
      // The controller must also gate new model work and assignment changes on deletionPending.
      if (isLocalModelInUse(resolved) !== false)
        throw new Error("Wait for the current model work to finish.");

      if (unloadLocalRuntime) await unloadLocalRuntime();
      // Validate the path after unloading, without yielding between checks and unlink. Use the
      // canonical directory (e.g. for a system-level /tmp alias), not a symlink at modelsDir.
      const rootStat = lstatSync(root);
      if (!rootStat.isDirectory()) throw new Error("The models directory must not be a symlink.");
      const realRoot = realpathSync(root);
      const realRootStat = lstatSync(realRoot);
      if (rootStat.dev !== realRootStat.dev || rootStat.ino !== realRootStat.ino)
        throw new Error("The models directory changed during deletion.");
      const target = path.join(realRoot, path.basename(resolved));
      if (!lstatSync(target).isFile())
        throw new Error("The model must be a regular file, not a symlink.");
      unlinkSync(target);
      deleted = true;

      ({ clearedSingleModel } = await configStore.removeDeletedLocalModel(resolved));
      if (currentChooser()) {
        models = await listModels();
        modelSettings = getModelSettings(models);
      }
    } catch (cause) {
      error = deleted
        ? `Model deleted, but cleanup could not finish: ${cause.message}`
        : `Could not delete model: ${cause.message}`;
    } finally {
      deletionPending = false;
    }

    const current = currentChooser();
    if (current) {
      const { [deletionScope]: _, ...next } = current;
      if (deleted) {
        next.models =
          models && modelSettings
            ? [...models, ...current.models.filter((model) => model.provider !== "local")]
            : current.models.filter(
                (model) => model.provider !== "local" || path.resolve(model.id) !== resolved,
              );
        next.modelSettings = modelSettings ?? { ...current.modelSettings };
        delete next.modelSettings[resolved];
      }
      setModelModal({ ...next, error });
    }
    notify();
    return { deleted, clearedSingleModel, error };
  }

  function downloadModel(uri, fileName) {
    const modelModal = getModelModal();
    if (deletionPending || modelModal?.mode !== "download" || getActiveDownload()) return;
    const job = { id: getNextDownloadId(), controller: new AbortController() };
    setNextDownloadId(job.id + 1);
    let lastProgressAt = -Infinity;
    job.clearProgressTimer = () => {
      clearTimeout(job.progressTimer);
      job.progressTimer = undefined;
    };
    job.controller.signal.addEventListener("abort", job.clearProgressTimer, { once: true });
    setActiveDownload(job);
    const isCurrentModal = () =>
      getModelModal()?.mode === "download" && getModelModal().downloadId === job.id;
    const publishProgress = () => {
      job.progressTimer = undefined;
      if (!isCurrentModal() || job.controller.signal.aborted || job.settled) return;
      lastProgressAt = Date.now();
      const { totalSize, downloadedSize } = job.latestProgress;
      setModelModal({
        ...getModelModal(),
        totalSize,
        downloadedSize,
        progress: totalSize ? downloadedSize / totalSize : 0,
      });
      notify();
    };
    setModelModal({
      ...modelModal,
      downloadId: job.id,
      downloading: uri,
      downloadFileName: fileName,
      canceling: false,
      progress: 0,
      totalSize: 0,
      downloadedSize: 0,
      downloadNotice: null,
      error: null,
    });
    notify();
    job.promise = Promise.resolve()
      .then(() =>
        downloadFile(uri, {
          directory: modelsDir,
          fileName,
          signal: job.controller.signal,
          onProgress({ totalSize, downloadedSize }) {
            if (!isCurrentModal() || job.controller.signal.aborted || job.settled) return;
            job.latestProgress = { totalSize, downloadedSize };
            if (job.progressTimer !== undefined) return;
            const wait = 1000 - (Date.now() - lastProgressAt);
            if (wait <= 0) publishProgress();
            else job.progressTimer = setTimeout(publishProgress, wait);
          },
        }),
      )
      .then(async (resolvedPath) => {
        job.settled = true;
        job.clearProgressTimer();
        let configError;
        try {
          await configStore.ensureModel(resolvedPath);
        } catch (error) {
          configError = `Model downloaded, but its config could not be saved: ${error.message}`;
        }
        if (isCurrentModal()) {
          setModelModal({
            ...getModelModal(),
            ...job.latestProgress,
            downloading: null,
            canceling: false,
            progress: 1,
            error: configError ?? null,
          });
          notify();
        }
        addMessage({ type: "system", message: `Model downloaded: ${resolvedPath}` });
      })
      .catch((error) => {
        job.settled = true;
        job.clearProgressTimer();
        if (!isCurrentModal()) return;
        const canceled = error === job.controller.signal.reason;
        setModelModal({
          ...getModelModal(),
          downloading: null,
          canceling: false,
          progress: 0,
          downloadedSize: 0,
          totalSize: 0,
          downloadNotice: canceled ? "Download canceled. Partial files removed." : null,
          error: canceled ? null : `Download failed: ${error.message}`,
        });
        notify();
      })
      .finally(() => {
        job.clearProgressTimer();
        job.controller.signal.removeEventListener("abort", job.clearProgressTimer);
        if (getActiveDownload() === job) setActiveDownload(undefined);
      });
    return job.promise;
  }

  function cancelModelDownload() {
    const activeDownload = getActiveDownload();
    if (!activeDownload) return;
    const modelModal = getModelModal();
    if (modelModal?.downloadId === activeDownload.id) {
      setModelModal({ ...modelModal, canceling: true });
      notify();
    }
    activeDownload.controller.abort();
    return activeDownload.promise;
  }

  async function searchHuggingFace(query) {
    const modelModal = getModelModal();
    if (!modelModal || modelModal.mode !== "download" || !query.trim()) return;
    const trimmedQuery = query.trim();
    setModelModal({
      ...modelModal,
      query: trimmedQuery,
      searchQuery: trimmedQuery,
      downloads: [],
      searching: true,
      error: null,
    });
    notify();
    try {
      const downloads = await searchHuggingFaceModels(trimmedQuery);
      if (
        !getModelModal() ||
        getModelModal().mode !== "download" ||
        getModelModal().searchQuery !== trimmedQuery
      )
        return;
      setModelModal({ ...getModelModal(), downloads, searching: false });
      notify();
    } catch (error) {
      if (
        !getModelModal() ||
        getModelModal().mode !== "download" ||
        getModelModal().searchQuery !== trimmedQuery
      )
        return;
      setModelModal({ ...getModelModal(), searching: false, error: error.message });
      notify();
    }
  }

  return {
    listModels,
    getModelSettings,
    deleteModel,
    isModelDeletionPending: () => deletionPending,
    downloadModel,
    cancelModelDownload,
    searchHuggingFace,
  };
}
