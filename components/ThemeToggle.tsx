"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export default function ThemeToggle() {
  const { dark, sync, toggle } = useTheme();
  useEffect(() => sync(), [sync]);
  return (
    <button onClick={toggle} className="rounded-md border border-line p-1.5 text-muted hover:bg-subtle hover:text-ink" title={dark ? "Switch to light mode" : "Switch to dark mode"} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
