"use client";

// Used on /championship and on the Championship tab of /bets.
import { Fragment, useEffect, useMemo, useState } from "react";
import { championship } from "@/lib/engine";
import { useStore } from "@/lib/store";
import { Card, Caveats, Empty } from "./ui";
import { useSpotlight } from "./deeplink";
import { fmtDate, num } from "@/lib/format";

/** tied teams can earn fractions of a point, so they are not rounded away */
const pts = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function ChampionshipBoard({ focus = null }: { focus?: string | null }) {
  const { data, asOf } = useStore();
  const res = useMemo(() => (data ? championship(data, asOf) : null), [data, asOf]);
  const [open, setOpen] = useState<string | null>(null);
  useSpotlight(focus && `college-${focus}`);
  useEffect(() => {
    if (focus) setOpen(focus);
  }, [focus]);
  if (!res) return null;
  const v = res.value;
  if (!v.available) return <Empty>The original 2025 data has no competition results or contingents, so there is no Championship board. Switch to the simulated run to see it.</Empty>;

  return (
    <div className="space-y-4">
      {focus && !v.standings.some((s) => s.college_id === focus) && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">College {focus} has no results or contingent at the selected date.</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <Figure label="Championship leader" value={v.standings[0]?.points ? v.standings.filter((s) => s.rank === 1).map((s) => s.name).join(" and ") : "No results yet"} note={v.standings[0]?.points ? `${pts(v.standings[0].points)} points` : ""} />
        <Figure label="Contingent Trophy (most verified attendees)" value={v.trophy ? v.trophy.colleges.map((c) => c.name).join(" and ") : "Not decided"} note={v.trophy ? `${num(v.trophy.verified)} verified attendees${v.trophy.colleges.length > 1 ? " each (tie)" : ""}` : "Needs gate scans from the fest"} />
        <Figure label="Results recorded" value={num(v.resultsCount)} note={`${pts(v.pointsAwarded)} points awarded by ${fmtDate(asOf)}`} />
      </div>
      {v.mismatches.length > 0 && (
        <details className="rounded-md bg-warn-soft px-3 py-2 text-[12px] text-warn">
          <summary className="cursor-pointer font-medium">{v.mismatches.length} recorded result(s) do not follow the points rules</summary>
          <ul className="mt-1 list-disc pl-5">
            {v.mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </details>
      )}
      <Card title="Standings by college">
        {!v.standings.length ? (
          <Empty>No contingents or results at this date.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line text-[12px] text-muted">
                <tr>
                  {["Rank", "College", "Points", "1st places", "Contingent registered", "Verified attendees", "Tier reached"].map((h, i) => (
                    <th key={h} className={`px-2 py-2 font-medium ${i < 2 ? "text-left" : "text-right"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.standings.map((s) => (
                  <Fragment key={s.college_id}>
                    <tr id={`college-${s.college_id}`} className="border-b border-line/70">
                      <td className="tabular px-2 py-1.5">{s.rank}</td>
                      <td className="px-2 py-1.5">
                        <button className="text-left font-medium hover:underline" aria-expanded={open === s.college_id} onClick={() => setOpen(open === s.college_id ? null : s.college_id)}>
                          {s.name}
                        </button>
                      </td>
                      <td className="tabular px-2 py-1.5 text-right font-semibold">{pts(s.points)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{num(s.firsts)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{num(s.registered)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{s.verified == null ? "not yet" : num(s.verified)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{s.tier || "none"}</td>
                    </tr>
                    {open === s.college_id && (
                      <tr className="border-b border-line/70 bg-slate-50">
                        <td />
                        <td colSpan={6} className="px-2 py-2 text-[12px]">
                          {!s.results.length ? (
                            "No competition results at this date."
                          ) : (
                            <ul className="space-y-0.5">
                              {s.results.map((r) => (
                                <li key={`${r.event_id}-${r.team}`}>
                                  {r.event}: {r.team}, position {r.position}, {r.points} points
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Caveats items={res.caveats} basis={res.basis} />
      </Card>
    </div>
  );
}

const Figure = ({ label, value, note }: { label: string; value: string; note: string }) => (
  <div className="rounded-lg border border-line bg-white px-4 py-3">
    <div className="text-[12px] text-muted">{label}</div>
    <div className="text-[16px] font-semibold">{value}</div>
    <div className="text-[12px] text-muted">{note}</div>
  </div>
);
