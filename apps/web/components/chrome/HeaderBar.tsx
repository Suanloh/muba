"use client";
/**
 * Fixed header bar — brand, network/chain switcher, notification center,
 * theme toggle, and the wallet account pill. Global actions slot lets pages
 * inject contextual actions (e.g. "Reset demo").
 */
import { useAppStore } from "@/lib/store/app-store";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "./Brand";
import { ChainSwitcher } from "./ChainSwitcher";
import { NotificationBell } from "./NotificationBell";
import { AccountMenu } from "./AccountMenu";

export function HeaderBar() {
  const { records, clearAll, setView } = useAppStore();
  const hasRecords = records.length > 0;

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-translucent backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <button
          type="button"
          onClick={() => setView("home")}
          aria-label="MOVA home"
          className="flex items-center gap-2.5 rounded-[10px] transition hover:opacity-90"
        >
          <BrandMark />
          <div className="flex items-baseline gap-2">
            <p className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">MOVA</p>
            <p className="hidden font-mono text-[11px] text-faint md:inline">
              AI-native payments on Sui
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2">
          {hasRecords && (
            <button
              type="button"
              onClick={() => clearAll()}
              className="hidden rounded-[12px] border border-hairline px-3 py-1.5 font-mono text-xs text-muted transition hover:border-hairline-strong hover:text-ink sm:inline"
              title="Clear all demo records, receipts, notifications and audit events so you can run the demo again from a clean slate."
            >
              Reset demo
            </button>
          )}
          <ChainSwitcher />
          <NotificationBell />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
