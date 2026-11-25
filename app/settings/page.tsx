"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { DEFAULT_SETTINGS, SETTING_HELP, resolveSettings, type EngineSettings } from "@/lib/engine";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export default function SettingsPage() {
  const { data, setSetting } = useStore();
  if (!data) return null;
  const s = resolveSettings(data.settings);
  const keys = Object.keys(SETTING_HELP) as (keyof EngineSettings)[];
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Assumptions and decision thresholds. Every value here is an ASSUMPTION, not sourced data. Changing one instantly recalculates projections and flags." />
      <Card title="Assumptions and thresholds" right={<Badge kind="assumption" />}>
        <div className="divide-y divide-line">
          {keys.map((k) => (
            <SettingRow key={`${k}-${s[k]}`} k={k} value={s[k]} onSave={(v) => setSetting(k, v)} />
          ))}
        </div>
      </Card>
      <Card title="Fixed rules (not editable)">
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700">
          <li>Actual attendee: distinct external person with at least one admitted AND verified check-in. Walk-ins count; internal, staff and test people never do.</li>
          <li>As-of means the end of the selected day in IST. Nothing dated later is counted.</li>
          <li>Rows with identical stable IDs are import copies and count once. If an ID repeats with a different payload, the last row wins and Data health warns.</li>
          <li>Registration status is the latest full-state history version at or before the snapshot time.</li>
          <li>Impressions, reach, clicks and sessions are anonymous counts and are never treated as people.</li>
          <li>Spend is net: vendor credits (negative rows) reduce it.</li>
        </ul>
      </Card>
    </div>
  );
}

function SettingRow({ k, value, onSave }: { k: keyof EngineSettings; value: number; onSave: (v: number) => void }) {
  const meta = SETTING_HELP[k];
  const toShow = (v: number) => (meta.kind === "pct" ? String(Math.round(v * 1000) / 10) : String(v));
  const [v, setV] = useState(toShow(value));
  const parsed = meta.kind === "pct" ? Number(v) / 100 : Number(v);
  const valid = v !== "" && Number.isFinite(parsed) && parsed >= 0 && (meta.kind !== "pct" || parsed <= 1);
  const changed = valid && parsed !== value;
  return (
    <div className="grid grid-cols-1 items-center gap-2 py-3 md:grid-cols-[260px_1fr_220px]">
      <div className="text-[13px] font-medium">{meta.label}</div>
      <div className="text-[12px] text-muted">{meta.help}</div>
      <div className="flex items-center justify-end gap-2">
        <input className={`w-24 rounded-md border px-2 py-1 text-right text-[13px] ${valid ? "border-line" : "border-bad"}`} value={v} onChange={(e) => setV(e.target.value)} />
        <span className="w-6 text-[12px] text-muted">{meta.kind === "pct" ? "%" : meta.kind === "ratio" ? "x" : ""}</span>
        <Button variant={changed ? "primary" : "default"} disabled={!changed} onClick={() => onSave(parsed)}>
          Save
        </Button>
      </div>
      {value !== DEFAULT_SETTINGS[k] && <div className="text-[11px] text-warn md:col-start-3 md:text-right">default {toShow(DEFAULT_SETTINGS[k])}</div>}
    </div>
  );
}
