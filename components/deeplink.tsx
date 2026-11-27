"use client";

// Direct links: "/campaigns?focus=C02" opens the page, scrolls to that item and highlights it.
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function Reader({ onParams }: { onParams: (p: URLSearchParams) => void }) {
  const query = useSearchParams().toString();
  useEffect(() => {
    onParams(new URLSearchParams(query));
    // only a change of address should run this, not a new function on each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return null;
}

/** Calls onParams on arrival and whenever the address's query changes, even on the same page. */
export function QueryParams({ onParams }: { onParams: (p: URLSearchParams) => void }) {
  return (
    <Suspense fallback={null}>
      <Reader onParams={onParams} />
    </Suspense>
  );
}

/** Scrolls to the element with this id and highlights it for a few seconds. */
export function useSpotlight(elementId: string | null) {
  useEffect(() => {
    if (!elementId) return;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const find = setTimeout(() => {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("spotlight");
      clear = setTimeout(() => el.classList.remove("spotlight"), 5000);
    }, 200);
    return () => {
      clearTimeout(find);
      clearTimeout(clear);
      document.getElementById(elementId)?.classList.remove("spotlight");
    };
  }, [elementId]);
}
