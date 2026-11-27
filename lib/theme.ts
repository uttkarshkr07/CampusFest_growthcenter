"use client";

import { create } from "zustand";

/** Light or dark. The class on <html> is the source of truth; layout.tsx sets it before paint. */
interface ThemeState {
  dark: boolean;
  sync: () => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  dark: false,
  sync: () => set({ dark: typeof document !== "undefined" && document.documentElement.classList.contains("dark") }),
  toggle: () => {
    const dark = !get().dark;
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("cf-theme", dark ? "dark" : "light");
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    set({ dark });
  },
}));

/** Chart colours for recharts, which needs plain colour values rather than classes. */
export function chartColors(dark: boolean) {
  // validated with the dataviz palette script against each surface (white, #121a2c)
  return dark
    ? { grid: "#273149", axis: "#94a0b6", brand: "#5b8cff", brand2: "#a9c2ff", goal: "#c98f2e", good: "#4cb67c", bad: "#e25d5d", neutral: "#7d89a1", band: "#5b8cff" }
    : { grid: "#e8ecf2", axis: "#64748b", brand: "#0f5bff", brand2: "#7ea6ff", goal: "#9a6212", good: "#1f7a3a", bad: "#c42b2b", neutral: "#8794a8", band: "#0f5bff" };
}

export function useChartColors() {
  return chartColors(useTheme((s) => s.dark));
}
