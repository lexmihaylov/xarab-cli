export function createActiveWork() {
  let current;

  async function run(kind, action, { parent } = {}) {
    if (current !== parent) {
      throw new Error(`Cannot start ${kind} while another operation is active.`);
    }

    const controller = parent?.controller ?? new AbortController();
    let settle;
    const done =
      parent?.done ??
      new Promise((resolve) => {
        settle = resolve;
      });
    const operation = {
      kind,
      controller,
      done,
      signal: controller.signal,
      generating: true,
      setGenerating(value) {
        operation.generating = value;
      },
    };
    current = operation;

    // Settlement is independent of success: callers still receive the original rejection.
    try {
      return await action(operation);
    } finally {
      current = parent;
      settle?.();
    }
  }

  return {
    run,
    getCurrent: () => current,
    isGenerating: () => current?.generating ?? false,
    isRouting: () => current?.kind === "classification" && current.generating,
    abort: () => current?.controller.abort(),
    whenIdle: () => current?.done,
  };
}
