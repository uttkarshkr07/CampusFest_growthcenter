// Thin proxy to Gemini. The key stays on the server; the rules and tool list are fixed here.
// Waiting for the model is network time, which does not count against the Worker CPU limit.
import { isOrganiser } from "@/lib/auth/verify";
import { classifyError, configuredModels, geminiRequest, parseBody } from "@/lib/copilot/gemini";

export const dynamic = "force-dynamic";

const fail = (status: number, kind: string, message: string, extra: Record<string, unknown> = {}) => Response.json({ error: { kind, message, ...extra } }, { status });

export async function GET() {
  return Response.json({ configured: !!process.env.GEMINI_API_KEY, models: configuredModels(process.env.GEMINI_MODELS) });
}

export async function POST(req: Request) {
  // Browsers send Origin on POST. This stops other websites using the endpoint, not scripts.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return fail(403, "auth", "This endpoint only serves this app.");

  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, "no_key", "The AI model is not set up on this deployment yet.");

  // with sign-in on, only a signed-in organiser can spend the model quota
  if (process.env.NEXT_PUBLIC_AUTH_MODE === "on" && !(await isOrganiser(req.headers.get("authorization")))) return fail(401, "auth", "Please sign in again to use the copilot.");

  const body = parseBody(await req.text());
  if (typeof body === "string") return fail(400, "bad_request", body);

  const models = configuredModels(process.env.GEMINI_MODELS);
  if (body.modelIndex >= models.length) return fail(400, "bad_request", "No such model.");
  const model = models[body.modelIndex];
  const hasFallback = body.modelIndex < models.length - 1;

  let res: Response;
  try {
    // GEMINI_BASE_URL exists only to point local development at a fake model
    const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
    res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(geminiRequest(body)),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return fail(502, "upstream", "The model took too long or could not be reached.", { hasFallback });
  }

  const payload = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: unknown[] }; finishReason?: string }[] } | null;
  if (!res.ok) {
    const e = classifyError(res.status, payload);
    return fail(res.status === 429 ? 429 : 502, e.kind, e.message, { retryAfterSec: e.retryAfterSec, hasFallback });
  }
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!parts?.length) return fail(502, "upstream", `The model returned no answer (${candidate?.finishReason ?? "no reason given"}).`, { hasFallback });
  return Response.json({ parts, model, finishReason: candidate?.finishReason });
}
