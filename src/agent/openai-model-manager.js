const MODELS_URL = new URL("https://chatgpt.com/backend-api/codex/models");
MODELS_URL.searchParams.set("client_version", "0.169.0");

export function createOpenAIModelManager({ getCredentials, fetchImpl = fetch }) {
  async function listModels({ signal } = {}) {
    const credentials = await getCredentials();
    const response = await fetchImpl(MODELS_URL, {
      headers: {
        originator: "xarab",
        "user-agent": "xarab/1.0.0",
        authorization: `Bearer ${credentials.access_token}`,
        "chatgpt-account-id": credentials.account_id,
        accept: "application/json",
      },
      signal,
    });
    if (!response.ok) {
      let code = "unknown_error";
      try {
        const body = await response.json();
        if (typeof body.error?.code === "string") code = body.error.code;
        else if (typeof body.error?.type === "string") code = body.error.type;
      } catch {
        // Avoid exposing provider response bodies.
      }
      const requestId =
        response.headers.get("x-request-id") ?? response.headers.get("openai-request-id");
      throw new Error(
        `Could not list OpenAI models (${response.status}, ${code}${requestId ? `, request ${requestId}` : ""}).`,
      );
    }
    const body = await response.json();
    const entries = Array.isArray(body) ? body : (body.models ?? []);
    return entries
      .filter((model) => model.slug || model.model_slug || model.id)
      .map((model) => {
        const id = model.slug ?? model.model_slug ?? model.id;
        return {
          provider: "openai",
          id,
          name: model.display_name || model.name || id,
          ...(model.supported_reasoning_levels
            ? { supported_reasoning_levels: model.supported_reasoning_levels }
            : {}),
          ...(model.default_reasoning_level != null
            ? { default_reasoning_level: model.default_reasoning_level }
            : {}),
        };
      });
  }
  return { listModels };
}
