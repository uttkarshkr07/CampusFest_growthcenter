import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import Shell from "@/components/Shell";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  title: "CampusFest Growth Center",
  description: "Attendee growth command center: funnel analytics, campaign and task management for CampusFest.",
  icons: { icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }] },
};

// Sets the theme class before the first paint, so a dark-mode reload never flashes white.
const THEME_SCRIPT = `try{var t=localStorage.getItem("cf-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
