// The few Markdown features the copilot uses: headings, bold, bullets. Builds elements, never raw HTML.
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-slate-100 px-1 text-[12px]">{part.slice(1, -1)}</code>;
    return part;
  });
}

export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { text: string; depth: number }[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-0.5 pl-5">
        {list.map((li, i) => (
          <li key={i} className={li.depth ? "ml-4" : ""}>{inline(li.text)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const bullet = raw.match(/^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push({ text: bullet[2], depth: bullet[1].length >= 2 ? 1 : 0 });
      continue;
    }
    flush();
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      <p key={blocks.length} className={heading || /^\*\*[^*]+\*\*:?$/.test(line) ? "pt-1 font-semibold" : ""}>
        {inline(heading ? heading[1] : line)}
      </p>,
    );
  }
  flush();
  return <div className="space-y-1.5 break-words">{blocks}</div>;
}
