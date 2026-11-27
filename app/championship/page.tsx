"use client";

import { useState } from "react";
import ChampionshipBoard from "@/components/ChampionshipBoard";
import { QueryParams } from "@/components/deeplink";
import { PageHeader } from "@/components/ui";

export default function ChampionshipPage() {
  const [focus, setFocus] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <QueryParams onParams={(p) => setFocus(p.get("focus"))} />
      <PageHeader title="College Championship" subtitle="Points by college from competition results, and the Contingent Trophy, as of the selected date." />
      <ChampionshipBoard focus={focus} />
    </div>
  );
}
