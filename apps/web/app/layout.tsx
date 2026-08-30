import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "MOVA — Autonomous Payment Agent",
  description:
    "MOVA lets users describe what they want to pay in plain language. It finds the best route, checks compliance, manages financial exposure, and settles the payment on Sui — while keeping a human in control.",
};

/**
 * Set the theme before first paint so the browser never flashes the wrong
 * theme. Falls back to dark (the default) when nothing is stored.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("mova-theme");var r=document.documentElement;r.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-hydration theme script may set
    // data-theme before React hydrates — that's intentional, not a mismatch.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
