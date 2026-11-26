// Server side of the model call: builds the Gemini request and turns its errors into the
// few kinds the browser knows how to handle. No Next.js imports, so it is testable.
import declarations from "./declarations.json";
import { SYSTEM_RULES } from "./prompt";
import type { Content, ModelErrorKind } from "./types";

export const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
export const MAX_BODY_BYTES = 160_000;
const MAX_CONTENTS = 24;

export function configuredModels(envValue: string | undefined): string[] {
  const list = (envValue ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9.\-]+$/i.test(s));
  return list.length ? list : DEFAULT_MODELS;
}

export interface ProxyBody {
  contents: Content[];
  finalRound: boolean;
  modelIndex: number;
}

export function parseBody(raw: string): ProxyBody | string {
  if (raw.length > MAX_BODY_BYTES) return "The request is too large.";
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "The request is not valid JSON.";
  }
  const b = body as Partial<ProxyBody>;
  if (!Array.isArray(b.contents) || !b.contents.length || b.contents.length > MAX_CONTENTS) return "The conversation is missing or too long.";
  const bad = b.contents.some((c) => !c || (c.role !== "user" && c.role !== "model") || !Array.isArray(c.parts));
  if (bad) return "The conversation has an invalid entry.";
  return { contents: b.contents, finalRound: !!b.finalRound, modelIndex: Number.isInteger(b.modelIndex) && b.modelIndex! >= 0 ? b.modelIndex! : 0 };
}

export function geminiRequest(body: ProxyBody) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_RULES }] },
    contents: body.contents,
    tools: [{ functionDeclarations: declarations }],
    toolConfig: { functionCallingConfig: { mode: body.finalRound ? "NONE" : "AUTO" } },
    generationConfig: { maxOutputTokens: 4096 },
  };
}

export interface ProxyError {
  kind: ModelErrorKind;
  message: string;
  retryAfterSec: number | null;
}

/** Turn a failed Gemini response into something a person can act on. Never echoes the key. */
export function classifyError(status: number, payload: unknown): ProxyError {
  const err = (payload as { error?: { message?: string; details?: Record<string, unknown>[] } } | null)?.error;
  const details = err?.details ?? [];
  const retry = details.map((d) => d.retryDelay).find((x) => typeof x === "string") as string | undefined;
  const retryAfterSec = retry ? Number.parseFloat(retry) : null;
  if (status === 429) {
    const text = JSON.stringify(details) + (err?.message ?? "");
    if (/per\s?day|PerDay/i.test(text)) return { kind: "quota_day", message: "Today's free requests for this model are used up. Google resets them at midnight Pacific time.", retryAfterSec };
    return { kind: "rate", message: "The free model's per-minute limit was reached. Wait a moment and ask again.", retryAfterSec };
  }
  if (status === 404) return { kind: "unavailable", message: "The configured model is not available for this key.", retryAfterSec };
  if (status === 503 || status === 500) return { kind: "unavailable", message: "The model is busy or unavailable right now.", retryAfterSec };
  if (status === 401 || status === 403) return { kind: "no_key", message: "The model key was rejected. The site owner needs to check it.", retryAfterSec };
  if (status === 400) return { kind: "bad_request", message: `The model rejected the request: ${(err?.message ?? "unknown reason").slice(0, 300)}`, retryAfterSec };
  return { kind: "upstream", message: `The model service returned an error (${status}).`, retryAfterSec };
}
