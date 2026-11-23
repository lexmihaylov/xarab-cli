// One local worker adapter per application. Only command validation can overlap
// an existing run; ordinary local work still uses a single slot.
export function createLocalWorkerRuntime(factory, { unavailableReason = () => undefined } = {}) {
  let adapter;
  let work;
  let validation;
  let unloading;
  let closed = false;
  let disposal;
  const shutdown = new AbortController();
  const waiters = new Set();
  const isBusy = () => Boolean(work || validation || unloading);

  function wakeWaiters() {
    for (const finish of [...waiters]) finish();
  }

  function checkAvailable(signal) {
    if (closed) throw new Error("Local worker runtime is closed.");
    signal?.throwIfAborted();
    const reason = unavailableReason();
    if (reason) throw new Error(reason);
  }

  function idle(signal) {
    return new Promise((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", abort);
        waiters.delete(finish);
        resolve();
      };
      const abort = () => {
        signal.removeEventListener("abort", abort);
        waiters.delete(finish);
        reject(signal.reason);
      };
      waiters.add(finish);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  return {
    createAdapter({ wait = false, validate = false } = {}) {
      return {
        async run(request) {
          checkAvailable(request.signal);
          if (validate) {
            if (validation || unloading) throw new Error("Local command validation is busy.");
            if (Object.keys(request.tools ?? {}).length)
              throw new Error("Local command validation cannot use tools.");
            const signal = request.signal
              ? AbortSignal.any([request.signal, shutdown.signal])
              : shutdown.signal;
            validation = Promise.resolve().then(() => {
              checkAvailable(signal);
              adapter ??= factory();
              if (!adapter.runValidation) throw new Error("Local command validation is unavailable.");
              return adapter.runValidation({ ...request, signal });
            });
            try {
              return await validation;
            } finally {
              validation = undefined;
              wakeWaiters();
            }
          }

          while (isBusy() && wait) {
            await idle(request.signal);
            checkAvailable(request.signal);
          }
          if (isBusy())
            throw new Error("Local worker is busy; retry after the active local run finishes.");
          work = Promise.resolve().then(() => {
            checkAvailable(request.signal);
            adapter ??= factory();
            return adapter.run(request);
          });
          try {
            return await work;
          } finally {
            work = undefined;
            wakeWaiters();
          }
        },
        // Individual workers do not own the shared runtime.
        async dispose() {},
      };
    },
    isBusy,
    async unload() {
      if (closed) throw new Error("Local worker runtime is closed.");
      if (isBusy()) throw new Error("The local worker is busy.");
      const previous = adapter;
      adapter = undefined;
      unloading = Promise.resolve().then(() => previous?.dispose?.());
      try {
        await unloading;
      } finally {
        unloading = undefined;
        wakeWaiters();
      }
    },
    dispose() {
      if (disposal) return disposal;
      closed = true;
      disposal = (async () => {
        await Promise.allSettled([work, validation, unloading]);
        await adapter?.dispose?.();
      })();
      shutdown.abort(new Error("Local worker runtime is shutting down."));
      wakeWaiters();
      return disposal;
    },
  };
}
