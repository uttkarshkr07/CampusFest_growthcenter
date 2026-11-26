// Browser side of the model call.
import { ModelError, type ModelReply, type ModelRequest } from "./types";

export async function callModel(request: ModelRequest, token?: string | null): Promise<ModelReply> {
  let res: Response;
  try {
    res = await fetch("/api/copilot", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(request),
    });
  } catch {
    throw new ModelError("network", "Could not reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.parts) {
    const e = body?.error;
    throw new ModelError(e?.kind ?? "upstream", e?.message ?? `The server returned an error (${res.status}).`, e?.retryAfterSec ?? null, !!e?.hasFallback);
  }
  return body as ModelReply;
}
