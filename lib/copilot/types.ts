// Shapes shared by the browser loop, the server proxy, storage and the chat screens.

export interface FunctionCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
}

/** A Gemini content part. Parts that come from the model are sent back exactly as received
 *  (they carry thought signatures that the API requires during a tool turn). */
export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: FunctionCall;
  functionResponse?: { name: string; id?: string; response: unknown };
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface ModelRequest {
  contents: Content[];
  /** true on the last allowed request: the model must answer in text */
  finalRound: boolean;
  modelIndex: number;
}

export interface ModelReply {
  parts: Part[];
  model: string;
  finishReason?: string;
}

export type ModelErrorKind = "quota_day" | "rate" | "unavailable" | "no_key" | "auth" | "bad_request" | "upstream" | "network";

export class ModelError extends Error {
  constructor(
    public kind: ModelErrorKind,
    message: string,
    public retryAfterSec: number | null = null,
    /** another configured model can be tried */
    public hasFallback = false,
  ) {
    super(message);
  }
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  asOfUsed: string;
  ok: boolean;
  basis: string[];
  caveats: string[];
  value: unknown;
  error?: string;
}

export interface TaskProposal {
  title: string;
  description: string;
  campaign_id: string | null;
  owner_id: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  reason: string;
  evidence: string[];
}

export type ChatAction =
  | { type: "task"; id: string; proposal: TaskProposal; status: "proposed" | "created" | "dismissed"; taskId?: string }
  | { type: "link"; id: string; label: string; href: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** the date selected on screen when this was written; later turns are hidden from the model at earlier dates */
  asOf: string;
  createdAt: string;
  model?: string;
  requests?: number;
  tools?: ToolTrace[];
  actions?: ChatAction[];
  /** figures in the answer that were not found in any engine output */
  unverified?: string[];
  summaryUsed?: boolean;
  error?: boolean;
}
