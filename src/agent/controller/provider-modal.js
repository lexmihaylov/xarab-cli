export function createProviderModal({ providers, chooserCommand, closeModelModalForProvider, notify }) {
  let providerModal = null;
  let providerRequest = 0;

  async function openProviderModal() {
    const request = ++providerRequest;
    closeModelModalForProvider();
    providerModal = {
      providers: providers.map(({ id, name, method }) => ({ id, name, method })),
      selected: providers[0]?.id,
      busy: true,
    };
    notify();
    const statuses = await Promise.all(
      providers.map(async (provider) => {
        try {
          return [provider.id, await provider.status()];
        } catch (error) {
          return [provider.id, `Status unavailable: ${error.message}`];
        }
      }),
    );
    if (request !== providerRequest) {
      return;
    }
    providerModal = { ...providerModal, statuses: Object.fromEntries(statuses), busy: false };
    notify();
  }

  function closeProviderModal() {
    ++providerRequest;
    providerModal = null;
    notify();
  }

  async function providerAction(id, action, input) {
    const provider = providers.find((candidate) => candidate.id === id);
    if (
      !providerModal ||
      !provider ||
      !["connect", "copy", "complete", "disconnect"].includes(action) ||
      typeof provider[action] !== "function"
    ) {
      return;
    }
    const request = providerRequest;
    providerModal = { ...providerModal, busy: true, error: null };
    notify();
    try {
      const result = await provider[action](input);
      if (request !== providerRequest) {
        return;
      }
      const status = await provider.status();
      if (request !== providerRequest) {
        return;
      }
      providerModal = {
        ...providerModal,
        busy: false,
        statuses: { ...providerModal.statuses, [id]: status },
        pending:
          action === "connect"
            ? { id, url: result.url, copied: result.copied }
            : action === "copy"
              ? { ...providerModal.pending, copied: result }
              : null,
        feedback:
          action === "complete"
            ? provider.method === "apiKey"
              ? `API key saved locally. Refresh ${chooserCommand} to verify available models.`
              : "Connected successfully."
            : action === "disconnect"
              ? "Disconnected locally."
              : null,
      };
    } catch (error) {
      if (request !== providerRequest) {
        return;
      }
      providerModal = { ...providerModal, busy: false, error: error.message };
    }
    notify();
  }

  return {
    getState: () => providerModal,
    openProviderModal,
    closeProviderModal,
    providerAction,
  };
}
