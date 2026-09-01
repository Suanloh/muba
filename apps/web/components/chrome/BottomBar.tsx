"use client";
/**
 * Multi-ecosystem bottom bar (mobile, <1024px) — quick-access to Home, the
 * ecosystem switcher, a raised QR scanner FAB, frequent dapp actions, and the
 * account/wallet. Replaces the sidebar on small screens; safe-area aware.
 */
import { useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Settings, Zap } from "lucide"; // data, not components
import { useAppStore, type AppView } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { QrScanInterface } from "@/components/QrScanInterface";
import { BottomSheet } from "./BottomSheet";
import { ChainList } from "./ChainSwitcher";
import { AccountPanel } from "./AccountPanel";

type SheetId = "ecosystem" | "scan" | "actions" | "account";

function BarIcon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const QUICK_ACTIONS: { id: AppView; label: string; hint: string; d: string }[] = [
  { id: "home", label: "Pay / Send", hint: "Chat composer", d: "M12 5v14M5 12h14" },
  { id: "portfolio", label: "Portfolio", hint: "Balances", d: "M4 6h16v12H4zM8 10h8M8 14h5" },
  { id: "activity", label: "Activity", hint: "History", d: "M4 6h16M4 12h10M4 18h7" },
  { id: "settings", label: "Settings", hint: "Sound · privacy", d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" },
];

export function BottomBar() {
  const { view, setView } = useAppStore();
  const { connection } = useMovaWallet();
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const close = () => setSheet(null);

  const connected = connection.status === "connected";

  const Slot = ({
    active,
    onClick,
    label,
    icon,
  }: {
    active?: boolean;
    onClick: () => void;
    label: string;
    icon: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center justify-center gap-1 rounded-[10px] py-2 text-[10px] font-medium transition ${
        active ? "text-signal-text" : "text-muted hover:text-ink"
      }`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-translucent pb-safe backdrop-blur lg:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-center gap-1 px-3 pt-1">
          <Slot
            active={view === "home"}
            onClick={() => setView("home")}
            label="Home"
            icon={<BarIcon d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />}
          />
          <Slot
            active={sheet === "ecosystem"}
            onClick={() => setSheet("ecosystem")}
            label="Networks"
            icon={<BarIcon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />}
          />

          {/* Raised scan FAB */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setSheet("scan")}
              aria-label="Scan a payment QR"
              className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full border border-signal bg-signal text-white shadow-pop transition hover:opacity-90 active:scale-95"
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
                <path d="M4 12h16" />
              </svg>
            </button>
          </div>

          <Slot
            active={sheet === "actions"}
            onClick={() => setSheet("actions")}
            label="Actions"
            icon={
              <MorphIcon icon={Zap} size={20} strokeWidth={2} spring="snappy" reducedMotion="user" />
            }
          />
          <Slot
            active={sheet === "account"}
            onClick={() => setSheet("account")}
            label={connected ? "Wallet" : "Connect"}
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="6" width="18" height="13" rx="2.5" />
                <path d="M16 12.5h.01M3 10h18" />
              </svg>
            }
          />
        </div>
      </nav>

      {/* Ecosystem sheet */}
      <BottomSheet open={sheet === "ecosystem"} onClose={close} title="Networks & ecosystems">
        <ChainList onClose={close} />
      </BottomSheet>

      {/* QR scanner sheet */}
      <BottomSheet open={sheet === "scan"} onClose={close} title="Scan a payment QR">
        <QrScanInterface />
      </BottomSheet>

      {/* Quick actions sheet */}
      <BottomSheet open={sheet === "actions"} onClose={close} title="Quick actions">
        <div className="space-y-1">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setView(a.id);
                close();
              }}
              className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm text-muted transition hover:bg-surface-2 hover:text-ink"
            >
              {a.id === "settings" ? (
                <MorphIcon icon={Settings} size={20} strokeWidth={2} spring="snappy" reducedMotion="user" />
              ) : (
                <BarIcon d={a.d} />
              )}
              <span className="flex flex-col">
                <span className="font-medium text-ink">{a.label}</span>
                <span className="text-[11px] text-faint">{a.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Account sheet */}
      <BottomSheet open={sheet === "account"} onClose={close} title="Account & wallets">
        <AccountPanel onClose={close} />
      </BottomSheet>
    </>
  );
}
