"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus, X } from "lucide-react";
import { useAuth } from "@/lib/auth/store";
import { useChat } from "@/lib/copilot/store";
import { MASCOT } from "@/lib/mascot";
import { useStore } from "@/lib/store";
import ChatThread from "./ChatThread";

export function MascotFace({ size = 28 }: { size?: number }) {
  return MASCOT.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={MASCOT.image} alt="" width={size} height={size} className="rounded-full object-cover" />
  ) : (
    <span aria-hidden style={{ fontSize: size * 0.75, lineHeight: 1 }}>{MASCOT.emoji}</span>
  );
}

/** The side panel, opened by the mascot. It sits beside the page so answers can be checked against it. */
export default function CopilotPanel() {
  const { open, setOpen, init, newChat, sessions, currentId, openSession, busy } = useChat();
  const ready = useStore((s) => s.status === "ready");
  const path = usePathname();
  const userKey = useAuth((s) => s.me?.userId ?? "local");

  useEffect(() => {
    void init(userKey);
  }, [init, userKey]);

  if (!ready || path.startsWith("/copilot")) return null;
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-white py-2 pl-3 pr-4 shadow-lg hover:bg-brand-soft" aria-label={`Open ${MASCOT.name}`}>
        <MascotFace />
        <span className="text-[13px] font-semibold">Ask {MASCOT.name}</span>
      </button>
    );
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-line bg-canvas shadow-xl lg:sticky lg:top-0 lg:h-screen lg:w-[400px] lg:shrink-0 lg:shadow-none">
      <header className="flex items-center gap-2 border-b border-line bg-white px-3 py-2">
        <MascotFace />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{MASCOT.name}</div>
          <div className="text-[11px] text-muted">AI growth copilot</div>
        </div>
        {sessions.length > 0 && (
          <select className="max-w-36 rounded-md border border-line bg-white px-1.5 py-1 text-[12px]" value={currentId ?? ""} disabled={busy} onChange={(e) => (e.target.value ? openSession(e.target.value) : newChat())} aria-label="Chat history">
            <option value="">New chat</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        )}
        <button onClick={newChat} disabled={busy} className="rounded p-1 text-muted hover:bg-slate-100" title="New chat" aria-label="New chat">
          <MessageSquarePlus className="h-4 w-4" />
        </button>
        <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-slate-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </header>
      <ChatThread />
    </aside>
  );
}
