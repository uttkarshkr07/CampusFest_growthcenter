"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, ListPlus, Loader2, Send } from "lucide-react";
import { useChat } from "@/lib/copilot/store";
import type { ChatAction, ChatMessage, TaskProposal } from "@/lib/copilot/types";
import { useStore } from "@/lib/store";
import { addDays } from "@/lib/engine";
import { MASCOT } from "@/lib/mascot";
import TaskDialog, { blankTask, type TaskDraft } from "@/components/TaskDialog";
import { Button } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import Markdown from "./Markdown";

const STARTERS = [
  "Are we on track for the visitor goal?",
  "What is the biggest problem right now?",
  "Whom should we follow up with this week?",
  "What if we cut the budget by 20%?",
];

export default function ChatThread() {
  const { messages, busy, loading, notice, status, send, model } = useChat();
  const asOf = useStore((s) => s.asOf);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // braces matter: scrollIntoView returns a Promise in newer browsers, and an effect must not return it
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy, status]);

  const submit = (q: string) => {
    if (!q.trim() || busy || loading) return;
    setText("");
    void send(q);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening the chat...
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-700">{MASCOT.greeting}</p>
            <div className="flex flex-col items-start gap-1.5">
              {STARTERS.map((q) => (
                <button key={q} onClick={() => submit(q)} className="rounded-full border border-line px-3 py-1 text-left text-[12px] hover:bg-brand-soft">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id}>
            {i > 0 && messages[i - 1].asOf !== m.asOf && (
              <div className="my-2 border-t border-dashed border-line pt-1 text-center text-[11px] text-muted">Selected date changed to {fmtDate(m.asOf)}</div>
            )}
            {m.role === "user" ? (
              <div className="ml-8 rounded-lg bg-brand px-3 py-2 text-[13px] text-white">{m.text}</div>
            ) : (
              <>
                {m.asOf > asOf && (
                  <p className="mb-1 text-[11px] text-warn">Answered with a later date selected ({fmtDate(m.asOf)}). The copilot cannot see this answer at the date selected now.</p>
                )}
                <Answer message={m} />
              </>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status}
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-line p-3">
        {notice && <p role="status" className="mb-2 text-[12px] text-warn">{notice}</p>}
        {model && !model.configured && <p className="mb-2 text-[12px] text-warn">The AI model is not set up on this deployment yet. The Actions and What-if screens work without it.</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <textarea
            className="max-h-32 min-h-9 flex-1 resize-y rounded-md border border-line px-2.5 py-1.5 text-[13px]"
            rows={2}
            maxLength={1000}
            placeholder={`Ask about the data as of ${fmtDate(asOf)}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(text);
              }
            }}
          />
          <Button type="submit" variant="primary" disabled={busy || loading || !text.trim()} title="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted">
          Runs on a free-tier Google Gemini model with limited daily requests. On the free tier, Google may use questions and replies to improve its products, and people may review them. Do not enter personal or confidential information. Check important numbers against the dashboard.
        </p>
      </div>
    </div>
  );
}

function Answer({ message: m }: { message: ChatMessage }) {
  if (m.error)
    return (
      <div className="mr-4 rounded-lg border border-red-200 bg-bad-soft px-3 py-2 text-[13px] text-bad">
        <div className="font-semibold">No AI answer</div>
        <div>{m.text}</div>
        <div className="mt-1 text-[12px]">
          The numbers are still available without the AI: <Link className="underline" href="/">Overview</Link>, <Link className="underline" href="/actions">Actions</Link>, <Link className="underline" href="/whatif">What-if</Link>.
        </div>
      </div>
    );
  return (
    <div className="mr-4 rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
      <Markdown text={m.text} />
      {!!m.unverified?.length && (
        <div className="mt-2 flex gap-1.5 rounded-md bg-warn-soft px-2 py-1.5 text-[12px] text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Check these figures: {m.unverified.join(", ")}. They were not found in the data the copilot was given.</span>
        </div>
      )}
      {m.actions?.map((a) => <ActionCard key={a.id} message={m} action={a} />)}
      <Evidence message={m} />
    </div>
  );
}

function ActionCard({ message, action }: { message: ChatMessage; action: ChatAction }) {
  const { data, notify } = useStore();
  const setActionStatus = useChat((s) => s.setActionStatus);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  if (action.type === "link")
    return (
      <Link href={action.href} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-brand px-2.5 py-1.5 text-[13px] font-medium text-brand hover:bg-brand-soft">
        Take me there: {action.label} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    );
  const p: TaskProposal = action.proposal;
  const owner = data?.team.find((t) => t.owner_id === p.owner_id);
  const campaign = data?.campaigns.find((c) => c.campaign_id === p.campaign_id);
  const review = () =>
    setDraft(
      blankTask(message.asOf, {
        title: p.title,
        description: p.description,
        campaign_id: campaign?.campaign_id ?? null,
        owner_id: owner?.owner_id ?? null,
        due_at: `${p.due_date && p.due_date >= message.asOf ? p.due_date : addDays(message.asOf, 3)}T18:00:00+05:30`,
        priority: p.priority,
        origin: "copilot",
        origin_ref: { rule: "Copilot suggestion", asOf: message.asOf, reason: p.reason, evidence: p.evidence, model: message.model },
      }),
    );
  return (
    <div className="mt-2 rounded-md border border-brand/40 bg-brand-soft p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
        <ListPlus className="h-3.5 w-3.5" /> Task draft{action.status === "proposed" ? " (not saved)" : ""}
      </div>
      <div className="mt-1 font-semibold">{p.title}</div>
      {p.reason && <div className="text-[12px] text-slate-700">Why: {p.reason}</div>}
      <div className="mt-0.5 text-[12px] text-muted">
        {owner ? owner.owner_name : "Unassigned"} · {campaign ? campaign.campaign_name : "No campaign"} · {p.priority} priority
      </div>
      {action.status === "proposed" ? (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={review}>Review and create</Button>
          <Button onClick={() => setActionStatus(message.id, action.id, "dismissed")}>Dismiss</Button>
        </div>
      ) : action.status === "created" && action.taskId && !data?.tasks.some((t) => t.id === action.taskId) ? (
        <div className="mt-2 text-[12px] text-muted">Created earlier. It is no longer in Tasks (deleted, or cleared by a reset).</div>
      ) : action.status === "created" ? (
        <div className="mt-2 text-[12px] font-medium text-good">
          Created. <Link className="underline" href={action.taskId ? `/tasks?focus=${action.taskId}` : "/tasks"}>See it in Tasks</Link>
        </div>
      ) : (
        <div className="mt-2 text-[12px] text-muted">Dismissed. Nothing was saved.</div>
      )}
      <TaskDialog
        open={!!draft}
        initial={draft}
        onClose={() => setDraft(null)}
        onSaved={(task) => {
          void setActionStatus(message.id, action.id, "created", task?.id);
          notify("Task created from the copilot's draft.");
        }}
      />
    </div>
  );
}

function Evidence({ message: m }: { message: ChatMessage }) {
  const tools = m.tools ?? [];
  return (
    <details className="mt-2 border-t border-line pt-1.5 text-[11.5px] text-muted">
      <summary className="cursor-pointer select-none">
        Evidence: data summary{tools.length ? ` + ${tools.length} lookup${tools.length > 1 ? "s" : ""}` : ""} · as of {fmtDate(m.asOf)}
        {m.model ? ` · ${m.model}` : ""}
        {m.requests ? ` · ${m.requests} request${m.requests > 1 ? "s" : ""}` : ""}
      </summary>
      <div className="mt-1.5 space-y-2">
        <p>
          Data summary: computed by the app from the current data at this date (targets vs actuals, funnel, campaign table, scale / watch / stop flags, projection before the event, task counts, and which tables and fields exist).
        </p>
        {tools.map((t, i) => (
          <div key={i} className="rounded border border-line p-1.5">
            <div className="font-semibold text-ink">
              {t.name} <span className="font-normal text-muted">as of {t.asOfUsed}</span>
            </div>
            {Object.keys(t.args).length > 0 && <div className="break-all font-mono text-[10.5px]">{JSON.stringify(t.args)}</div>}
            {t.error && <div className="text-bad">{t.error}</div>}
            {t.basis.length > 0 && (
              <ul className="list-disc pl-4">{t.basis.map((b) => <li key={b}>{b}</li>)}</ul>
            )}
            {t.caveats.length > 0 && (
              <ul className="list-disc pl-4 text-warn">{t.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            )}
            {t.value != null && (
              <details>
                <summary className="cursor-pointer">Result data</summary>
                <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-1.5 text-[10px]">{JSON.stringify(t.value, null, 1)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
