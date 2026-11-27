// One user question: at most `maxRequests` model requests, with tools run in the browser.
// The model and the tool runner are passed in, so the whole loop is testable without a live model.
import { unverifiedNumbers } from "./numcheck";
import { hrefFor } from "./targets";
import { OPEN_IN_APP, PROPOSE_TASK } from "./tool-defs.names";
import { ModelError, type ChatAction, type ChatMessage, type Content, type ModelReply, type ModelRequest, type Part, type TaskProposal, type ToolTrace } from "./types";

export const MAX_REQUESTS = 3;
const HISTORY_TURNS = 6;
const HISTORY_ANSWER_CHARS = 1200;
const TOOL_RESPONSE_CHARS = 14000;
const LAST_ROUND_NOTE = "No more lookups are available for this question. Do not call any function. Answer now from the SUMMARY and the results above, and say what is still missing.";
// some small models type the button call out as a Markdown link instead of calling the function
const TYPED_BUTTON = /\[[^\]\n]*\]\(\s*openInApp\?([^)\n]*)\)/g;
const MADE_UP_LINK = /\[([^\]\n]+)\]\(\s*(?!https?:\/\/[^)\s/]+\.[^)\s]+|\/)[^)\n]*\)/g;

export interface ToolOutcome {
  ok: boolean;
  asOfUsed: string;
  result?: unknown;
  error?: string;
}
/** May be async: some records are fetched only when a question needs them. */
export type ToolRunner = (name: string, args: unknown) => ToolOutcome | Promise<ToolOutcome>;

export interface TurnInput {
  question: string;
  selectedDate: string;
  summary: unknown;
  /** extra context: team list, signed-in user */
  context: Record<string, unknown>;
  history: ChatMessage[];
  /** shown as the first line of every answer, for example "Original 2025 data" */
  datasetLabel?: string;
  callModel: (req: ModelRequest) => Promise<ModelReply>;
  runTool: ToolRunner;
  maxRequests?: number;
  onStatus?: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
}

/**
 * Earlier turns as short text. Turns written at a later date than the one now selected are left out,
 * together with the question that led to them, because they can quote results not yet known.
 */
export function historyContents(history: ChatMessage[], selectedDate: string): Content[] {
  const pairs: [ChatMessage, ChatMessage][] = [];
  for (let i = 0; i + 1 < history.length; i++) {
    const q = history[i], a = history[i + 1];
    if (q.role !== "user" || a.role !== "assistant" || a.error) continue;
    if (q.asOf > selectedDate || a.asOf > selectedDate) continue;
    pairs.push([q, a]);
  }
  return pairs.slice(-HISTORY_TURNS).flatMap(([q, a]): Content[] => {
    const used = (a.tools ?? []).map((t) => `${t.name}(${JSON.stringify(t.args)})`).join(", ");
    const drafted = (a.actions ?? []).map((x) => (x.type === "task" ? `task draft "${x.proposal.title}" (${x.status})` : `button "${x.label}"`)).join(", ");
    const text = [`[answered with selected date ${a.asOf}]`, a.text.slice(0, HISTORY_ANSWER_CHARS), used && `[tools used: ${used.slice(0, 500)}]`, drafted && `[shown to user: ${drafted}]`].filter(Boolean).join("\n");
    return [
      { role: "user", parts: [{ text: q.text.slice(0, 1000) }] },
      { role: "model", parts: [{ text }] },
    ];
  });
}

/** labels carried by the simulated tickets a tool returned, by ticket id */
function simulatedLabels(result: unknown): [string, string][] {
  const tickets = (result as { value?: { tickets?: { id?: unknown; label?: unknown }[] } } | null | undefined)?.value?.tickets;
  return Array.isArray(tickets) ? tickets.flatMap((t): [string, string][] => (typeof t.label === "string" && t.label ? [[String(t.id), t.label]] : [])) : [];
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function toProposal(args: Record<string, unknown>): TaskProposal | null {
  const title = str(args.title, 140);
  if (!title) return null;
  const priority = ["low", "medium", "high"].includes(String(args.priority)) ? (args.priority as TaskProposal["priority"]) : "medium";
  const due = str(args.dueDate, 10);
  return {
    title,
    description: str(args.description, 2000),
    campaign_id: str(args.campaignId, 40) || null,
    ticket_id: str(args.ticketId, 40) || null,
    owner_id: str(args.ownerId, 40) || null,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    priority,
    reason: str(args.reason, 600),
    evidence: Array.isArray(args.evidence) ? args.evidence.map((e) => str(e, 300)).filter(Boolean).slice(0, 8) : [],
  };
}

function compactResult(result: unknown): unknown {
  const text = JSON.stringify(result);
  if (text.length <= TOOL_RESPONSE_CHARS) return result;
  return { truncated: true, note: "Result too large; ask a narrower question with query.", partial: text.slice(0, TOOL_RESPONSE_CHARS) };
}

const isTerminal = (name: string) => name === PROPOSE_TASK || name === OPEN_IN_APP;

async function attempt(input: TurnInput, modelIndex: number): Promise<ChatMessage> {
  const max = input.maxRequests ?? MAX_REQUESTS;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const brief = `SUMMARY (computed by the app from current data; selected date ${input.selectedDate})\n${JSON.stringify(input.summary)}\n\nCONTEXT\n${JSON.stringify(input.context)}`;
  const contents: Content[] = [...historyContents(input.history, input.selectedDate), { role: "user", parts: [{ text: brief }, { text: `QUESTION: ${input.question}` }] }];

  const traces: ToolTrace[] = [];
  const simulated = new Map<string, string>();
  const actions: ChatAction[] = [];
  const texts: string[] = [];
  let model = "";
  let requests = 0;
  let waited = false;

  for (let round = 0; round < max; round++) {
    const request: ModelRequest = { contents, finalRound: round === max - 1, modelIndex };
    let reply: ModelReply;
    try {
      reply = await input.callModel(request);
    } catch (e) {
      // one short wait for a per-minute limit, then repeat the same request
      if (e instanceof ModelError && e.kind === "rate" && !waited && e.retryAfterSec != null && e.retryAfterSec <= 30) {
        waited = true;
        input.onStatus?.(`Per-minute limit reached. Waiting ${Math.ceil(e.retryAfterSec)} seconds...`);
        await sleep(e.retryAfterSec * 1000 + 500);
        round--;
        continue;
      }
      throw e;
    }
    requests++;
    model = reply.model;

    const calls = reply.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    const text = reply.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    if (text) texts.push(text);

    const responses: Part[] = [];
    let needsAnotherRound = false;
    for (const call of calls) {
      const args = call.args ?? {};
      let response: unknown;
      if (call.name === PROPOSE_TASK) {
        const proposal = toProposal(args);
        if (proposal) actions.push({ type: "task", id: newId(), proposal, status: "proposed" });
        response = proposal ? { shownToUser: true, saved: false } : { error: "A task needs a title." };
      } else if (call.name === OPEN_IN_APP) {
        const href = hrefFor(String(args.target), typeof args.id === "string" ? args.id : undefined);
        if (href) actions.push({ type: "link", id: newId(), label: str(args.label, 60) || "Take me there", href });
        response = href ? { shownToUser: true } : { error: "Unknown target." };
      } else {
        needsAnotherRound = true;
        input.onStatus?.(`Checking the data: ${call.name}...`);
        const out = await input.runTool(call.name, args);
        const result = out.result as { value?: unknown; basis?: string[]; caveats?: string[] } | undefined;
        traces.push({ name: call.name, args, asOfUsed: out.asOfUsed, ok: out.ok, basis: result?.basis ?? [], caveats: result?.caveats ?? [], value: result?.value ?? null, error: out.error });
        response = out.ok ? compactResult(result) : { error: out.error };
        if (call.name === "tickets" && out.ok) for (const [id, label] of simulatedLabels(result)) simulated.set(id, label);
      }
      responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { result: response } } });
    }

    // A task draft or a button ends the turn: no further request is needed once the model has spoken.
    const done = !needsAnotherRound && (calls.length === 0 || (calls.every((c) => isTerminal(c.name)) && texts.length > 0));
    if (done) break;
    if (request.finalRound) {
      if (needsAnotherRound) texts.push("**What the data can't tell**\nI reached the lookup limit for one question, so this answer is incomplete. Ask a narrower follow-up.");
      break;
    }
    const lastNext = round === max - 2;
    contents.push({ role: "model", parts: reply.parts }, { role: "user", parts: lastNext ? [...responses, { text: LAST_ROUND_NOTE }] : responses });
    input.onStatus?.("Writing the answer...");
  }

  // only allowlisted targets become buttons; the typed link itself is never shown
  let answer = texts
    .join("\n\n")
    .replace(TYPED_BUTTON, (_all, queryText: string) => {
      const typed = new URLSearchParams(queryText);
      const href = hrefFor(typed.get("target") ?? "", typed.get("id") ?? undefined);
      if (!href) return "";
      if (!actions.some((a) => a.type === "link" && a.href === href)) actions.push({ type: "link", id: newId(), label: str(typed.get("label"), 60) || "Take me there", href });
      return "Use the button below.";
    })
    // any other typed link that is not a web address or an app path is made up: keep its words only
    .replace(MADE_UP_LINK, (_all, label: string) => label)
    .trim()
    .replace(/\n\s*\*\*[^*\n]+\*\*:?$/, "") // a heading left with nothing under it
    .trim();
  if (!answer && actions.length) answer = actions.some((a) => a.type === "task") ? "I drafted a task below. Review it, edit anything, then confirm. Nothing is saved yet." : "I can't make that change myself. Use the button below.";
  if (!answer) throw new ModelError("upstream", "The model returned an empty reply. Please try again.");

  // The model is told to repeat the label, but that is not left to chance: if it read a simulated
  // ticket, the answer and any task drafted for that ticket carry the label.
  for (const label of new Set(simulated.values())) if (!answer.includes(label)) answer = `**${label}**\n\n${answer}`;
  // every answer names the dataset it came from; code adds it so it never depends on the model
  if (input.datasetLabel) {
    const line = `*Data: ${input.datasetLabel}*`;
    if (!answer.startsWith(line)) answer = `${line}\n\n${answer}`;
  }
  for (const a of actions) {
    if (a.type !== "task") continue;
    const label = a.proposal.ticket_id ? simulated.get(a.proposal.ticket_id) : undefined;
    if (label && !a.proposal.description.includes(label)) a.proposal.description = `${label}\n\n${a.proposal.description}`.trim();
  }

  const sources: unknown[] = [input.summary, input.context, input.question, ...traces.flatMap((t) => [t.value, t.basis, t.caveats, t.args]), ...historyContents(input.history, input.selectedDate).map((c) => c.parts)];
  return {
    id: newId(),
    role: "assistant",
    text: answer,
    asOf: input.selectedDate,
    createdAt: new Date().toISOString(),
    model,
    requests,
    tools: traces,
    actions,
    summaryUsed: true,
    unverified: unverifiedNumbers(
      [answer, ...actions.flatMap((a) => (a.type === "task" ? [a.proposal.title, a.proposal.description, a.proposal.reason, ...a.proposal.evidence] : []))].join("\n"),
      sources,
    ),
  };
}

/** Runs a question, moving to the next configured model only by restarting the whole turn. */
export async function runTurn(input: TurnInput): Promise<ChatMessage> {
  for (let modelIndex = 0; ; modelIndex++) {
    try {
      return await attempt(input, modelIndex);
    } catch (e) {
      const canSwitch = e instanceof ModelError && e.hasFallback && ["quota_day", "unavailable", "rate", "upstream"].includes(e.kind);
      if (!canSwitch) throw e;
      input.onStatus?.("That model is unavailable. Trying the backup model...");
    }
  }
}
