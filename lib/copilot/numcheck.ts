// A cheap guard against invented figures: every number in an answer should exist somewhere in the
// engine output or the question. It cannot catch a real number used for the wrong thing.

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;

/** Strip things that look like numbers but are not claims: dates, times, ids, list markers. */
function stripNonClaims(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?/g, " ")
    .replace(/\b\d{1,2}(st|nd|rd|th)?[ -](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?( \d{4})?/gi, " ")
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?(,? \d{4})?/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b[A-Za-z]+\d+[A-Za-z0-9_-]*\b/g, " ") // C01, T03, P00012, T-3
    .replace(/\b(day|step|week|slide) \d+\b/gi, " ")
    .replace(/^\s*\d+[.)]\s/gm, " ");
}

const parse = (raw: string) => Number(raw.replace(/,/g, ""));

function collect(value: unknown, into: Set<number>) {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(Math.abs(value));
    if (Math.abs(value) <= 1) into.add(Math.abs(value) * 100); // rates stored as fractions
  } else if (typeof value === "string") {
    for (const m of value.match(NUMBER) ?? []) into.add(Math.abs(parse(m)));
  } else if (Array.isArray(value)) value.forEach((v) => collect(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collect(v, into));
}

export function unverifiedNumbers(answer: string, sources: unknown[]): string[] {
  const allowed = new Set<number>();
  sources.forEach((s) => collect(s, allowed));
  const list = [...allowed];
  const out = new Set<string>();
  const text = stripNonClaims(answer);
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0].replace(/,+$/, "");
    const value = Math.abs(parse(raw));
    if (!Number.isFinite(value)) continue;
    if (Number.isInteger(value) && value <= 10) continue; // small counts in prose
    if (value === 100) continue;
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const after = text.slice((m.index ?? 0) + m[0].length).toLowerCase();
    const scale = /^\s?(lakh|lac)\b/.test(after) ? 100000 : /^k\b/.test(after) ? 1000 : 1;
    const step = 10 ** -decimals;
    // accept the source figure itself or a rounding of it at the precision the answer used
    const found = list.some((a) => Math.abs(a / scale - value) <= step / 2 + 1e-9);
    if (!found) out.add(raw);
  }
  return [...out];
}
