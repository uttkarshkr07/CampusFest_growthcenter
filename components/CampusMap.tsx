"use client";

// The illustrated map is a static file of ours (public/campus_map.svg). Each venue is a shape
// <g id="VENxx"> with its label <g data-venue="VENxx"> on top; both open the venue.
import { useEffect, useRef, useState } from "react";
import type { VenueView } from "@/lib/engine";

export const FILL_STEPS = [
  { min: 95, label: "95% booked or more", box: "#7F2704", ink: "#FFFFFF" },
  { min: 80, label: "80 to 94%", box: "#E6550D", ink: "#000000" },
  { min: 50, label: "50 to 79%", box: "#FDAE6B", ink: "#000000" },
  { min: 0, label: "under 50%", box: "#FEEDDE", ink: "#000000" },
];
export const fillStep = (fill: number) => FILL_STEPS.find((s) => fill >= s.min)!;

/** remembers an element's own value, so a colour can be taken off again */
function paint(el: Element, name: string, value: string | null) {
  const kept = `data-own-${name}`;
  if (!el.hasAttribute(kept)) el.setAttribute(kept, el.getAttribute(name) ?? "");
  el.setAttribute(name, value ?? el.getAttribute(kept)!);
}

const venueAt = (target: EventTarget | null) => {
  const el = target instanceof Element ? target.closest("[data-venue], g.venue") : null;
  return el ? (el.getAttribute("data-venue") ?? el.id) : null;
};

export default function CampusMap({ venues, day, selected, colour, onSelect }: { venues: VenueView[]; day: string; selected: string | null; colour: boolean; onSelect: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/campus_map.svg")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setSvg(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // the markup is set once, by hand, so that React never replaces the painted nodes
  useEffect(() => {
    const el = box.current;
    if (!el || !svg) return;
    el.innerHTML = svg;
    const root = el.querySelector("svg");
    root?.setAttribute("width", "100%");
    root?.removeAttribute("height");
    root?.setAttribute("role", "group");
    root?.setAttribute("aria-label", "Campus map. Choose a venue.");
    el.querySelectorAll<SVGGElement>("g.venue, g[data-venue]").forEach((g) => (g.style.cursor = "pointer"));
    el.querySelectorAll("g[data-venue]").forEach((g) => {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
    });
  }, [svg]);

  useEffect(() => {
    const el = box.current;
    if (!el || !svg) return;
    for (const v of venues) {
      const label = el.querySelector(`g[data-venue="${v.venue_id}"]`);
      if (!label) continue;
      const fill = colour ? v.fillByDay[day] : undefined;
      const step = fill ? fillStep(fill.fill) : null;
      const rect = label.querySelector("rect");
      const [first, second] = label.querySelectorAll("text");
      if (rect) {
        paint(rect, "fill", step?.box ?? null);
        paint(rect, "stroke", selected === v.venue_id ? "#0F5BFF" : null);
        paint(rect, "stroke-width", selected === v.venue_id ? "8" : null);
      }
      if (first) paint(first, "fill", step?.ink ?? null);
      if (second) {
        paint(second, "fill", step?.ink ?? null);
        if (!second.hasAttribute("data-own-text")) second.setAttribute("data-own-text", second.textContent ?? "");
        second.textContent = fill ? `${Math.round(fill.fill)}% booked` : second.getAttribute("data-own-text");
      }
      label.setAttribute("aria-label", `${v.name}${fill ? `, ${Math.round(fill.fill)}% of seats booked` : ""}`);
      label.setAttribute("aria-pressed", String(selected === v.venue_id));
    }
  }, [svg, venues, day, selected, colour]);

  if (failed) return <p className="rounded-md bg-warn-soft p-3 text-[13px] text-warn">The map picture could not be loaded. Choose a venue from the list below.</p>;
  return (
    <div
      ref={box}
      className="campus-map min-h-40 overflow-hidden rounded-md"
      onClick={(e) => {
        const id = venueAt(e.target);
        if (id) onSelect(id);
      }}
      onKeyDown={(e) => {
        const id = e.key === "Enter" || e.key === " " ? venueAt(e.target) : null;
        if (!id) return;
        e.preventDefault();
        onSelect(id);
      }}
    />
  );
}
