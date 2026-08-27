import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "MOVA — Autonomous Payment Agent",
  description:
    "AI-native autonomous payment agent on Sui. Phase 1: wallet connectivity, Sui ownership model, and the app shell.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
