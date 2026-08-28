import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "MOVA — Autonomous Payment Agent",
  description:
    "MOVA lets users describe what they want to pay in plain language. It finds the best route, checks compliance, manages financial exposure, and settles the payment on Sui — while keeping a human in control.",
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
