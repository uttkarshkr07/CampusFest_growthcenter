"use client";

import { useState } from "react";
import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import ChatThread from "@/components/copilot/ChatThread";
import DatasetToggle from "@/components/DatasetToggle";
import { MascotFace } from "@/components/copilot/CopilotPanel";
import { Button, Modal, inputCls } from "@/components/ui";
import { AUTH_ON } from "@/lib/auth/config";
import { useAuth } from "@/lib/auth/store";
import type { SessionMeta } from "@/lib/copilot/storage";
import { DATASET_LABEL } from "@/lib/datasets";
import { useStore } from "@/lib/store";
import { useChat } from "@/lib/copilot/store";
import { MASCOT } from "@/lib/mascot";

/** When the chat was last used, in real time (not the date selected in the story). */
const lastUsed = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export default function CopilotPage() {
  const { sessions, currentId, openSession, newChat, renameSession, deleteSession, busy } = useChat();
  const me = useAuth((s) => s.me);
  const dataset = useStore((s) => s.dataset);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<SessionMeta | null>(null);

  const saveName = () => {
    if (renaming) void renameSession(renaming.id, renaming.title);
    setRenaming(null);
  };

  return (
    <div className={`flex ${dataset === "simulated" ? "h-[calc(100vh-8.25rem)]" : "h-[calc(100vh-6rem)]"} min-h-96 overflow-hidden rounded-lg border border-line bg-panel`}>
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="border-b border-line p-2">
          <Button variant="primary" className="w-full justify-center" onClick={newChat} disabled={busy}>
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </Button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {sessions.length === 0 && <li className="px-2 py-1 text-[12px] text-muted">No saved chats yet for the {DATASET_LABEL[dataset]}.</li>}
          {sessions.map((s) => (
            <li key={s.id} className={`group flex items-start gap-1 rounded-md px-2 py-1.5 ${s.id === currentId ? "bg-brand-soft" : "hover:bg-subtle"}`}>
              {renaming?.id === s.id ? (
                <input
                  autoFocus
                  className={inputCls}
                  maxLength={80}
                  aria-label="Chat name"
                  value={renaming.title}
                  onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <>
                  <button className="min-w-0 flex-1 text-left disabled:opacity-60" onClick={() => openSession(s.id)} disabled={busy} aria-current={s.id === currentId}>
                    <div className="line-clamp-2 text-[13px] leading-snug">{s.title}</div>
                    <div className="text-[11px] text-muted">Last used {lastUsed(s.updatedAt)}</div>
                  </button>
                  <button className="rounded p-0.5 text-muted hover:text-ink" onClick={() => setRenaming({ id: s.id, title: s.title })} aria-label={`Rename chat: ${s.title}`} title="Rename">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-0.5 text-muted hover:text-bad disabled:opacity-30" onClick={() => setDeleting(s)} disabled={busy && s.id === currentId} aria-label={`Delete chat: ${s.title}`} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-line p-2.5 text-[11px] leading-snug text-muted">
          {AUTH_ON && me
            ? `Saved to the ${me.name} demo account. Anyone who signs in as ${me.name} can read these chats. Resetting the demo data keeps them.`
            : "Saved in this browser only. Resetting the demo data keeps them."}
        </p>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
          <MascotFace />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{sessions.find((s) => s.id === currentId)?.title ?? "New chat"}</div>
            <div className="truncate text-[11px] text-muted">{MASCOT.name}, AI growth copilot, answering from: {DATASET_LABEL[dataset]}</div>
          </div>
          <DatasetToggle />
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <ChatThread />
        </div>
      </section>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this chat?">
        <p className="text-[13px]">&quot;{deleting?.title}&quot; and its messages will be removed. Tasks created from it stay.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleting) void deleteSession(deleting.id);
              setDeleting(null);
            }}
          >
            Delete chat
          </Button>
        </div>
      </Modal>
    </div>
  );
}
