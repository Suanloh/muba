"use client";
/**
 * Fixed header bar — brand, network/chain switcher, notification center,
 * theme toggle, and the wallet account pill. Global actions slot lets pages
 * inject contextual actions (e.g. "Reset demo").
 *
 * On <lg the desktop sidebar is hidden, so the header also carries a morphing
 * hamburger ↔ X toggle (morphicons + lucide data) that opens a mobile menu
 * with the primary destinations and the ecosystem rail.
 */
import { useState } from "react";
import { MorphIcon } from "morphicons/react";
import { Menu, Plus, ArrowRight, Settings, X } from "lucide"; // data, not components
import { useAppStore, type AppView } from "@/lib/store/app-store";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "./Brand";
import { ChainSwitcher, useChainActions } from "./ChainSwitcher";
import { NotificationBell } from "./NotificationBell";
import { AccountMenu } from "./AccountMenu";
import { ALL_CHAINS } from "@/lib/chrome/chains";

/** Small stroke-icon helper mirroring Sidebar's — used in the mobile menu. */
function MenuIcon({ d, extra }: { d: string; extra?: string }) {
  return (
    <svg
      className="h-[18px] w-[18px] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
      {extra ? <path d={extra} /> : null}
    </svg>
  );
}

/** Primary destinations, matching the desktop sidebar (Sidebar.tsx). */
const MOBILE_NAV: { id: AppView; label: string; hint: string; d: string; extra?: string }[] = [
  { id: "home", label: "Home", hint: "Dashboard & pay", d: "M3 10.5 12 3l9 7.5", extra: "M5 9.5V21h14V9.5" },
  { id: "activity", label: "Activity", hint: "Transaction history", d: "M4 6h16M4 12h10M4 18h7" },
  { id: "portfolio", label: "Portfolio", hint: "Balances", d: "M4 6h16v12H4z", extra: "M8 10h8M8 14h5" },
  { id: "settings", label: "Settings", hint: "Sound · privacy · demo", d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", extra: "M19 13.5v-3l2-1-1-2-2.3.7a7 7 0 0 0-1.2-.7L16 4.5h-2l-.5 2.3a7 7 0 0 0-1.2.7L10 6.5 9 8.5l2 1v3l-2 1 1 2 2.3-.7a7 7 0 0 0 1.2.7l.5 2.5h2l.5-2.5a7 7 0 0 0 1.2-.7L19 17.5l1-2-2-1z" },
];

export function HeaderBar() {
  const { records, clearAll, setView, view } = useAppStore();
  const hasRecords = records.length > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [payHover, setPayHover] = useState(false);
  const chainActions = useChainActions();

  const go = (id: AppView) => {
    setView(id);
    setMenuOpen(false);
  };

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

          {/* Mobile menu toggle — morphs Menu ↔ X (morphicons + lucide data). */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="mova-mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface text-muted transition hover:text-ink lg:hidden"
          >
            <MorphIcon
              icon={menuOpen ? X : Menu}
              size={18}
              strokeWidth={1.7}
              spring="snappy"
              reducedMotion="user"
            />
          </button>
        </div>
      </div>

      {/* Mobile menu (below the header on <lg) — primary nav + ecosystem rail. */}
      {menuOpen && (
        <nav
          id="mova-mobile-menu"
          aria-label="Primary"
          className="border-t border-hairline bg-translucent backdrop-blur lg:hidden"
        >
          <div className="mx-auto max-w-7xl space-y-5 px-4 py-4">
            {/* New payment primary action — Plus morphs to ArrowRight on hover (morphicons + lucide data). */}
            <button
              type="button"
              onClick={() => go("home")}
              onMouseEnter={() => setPayHover(true)}
              onMouseLeave={() => setPayHover(false)}
              className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-signal bg-signal px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              <MorphIcon
                icon={payHover ? ArrowRight : Plus}
                size={18}
                strokeWidth={2}
                spring="snappy"
                reducedMotion="user"
              />
              <span>New payment</span>
            </button>

            {/* Primary destinations */}
            <div className="space-y-1">
              {MOBILE_NAV.map((item) => {
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition ${
                      active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal"
                        aria-hidden="true"
                      />
                    )}
                    {item.id === "settings" ? (
                      <MorphIcon icon={Settings} size={18} strokeWidth={2} spring="snappy" reducedMotion="user" />
                    ) : (
                      <MenuIcon d={item.d} extra={item.extra} />
                    )}
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="truncate">{item.label}</span>
                      <span className="truncate text-[10px] text-faint">{item.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Ecosystems */}
            <div>
              <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                Ecosystems
              </p>
              <div className="space-y-0.5">
                {ALL_CHAINS.map((c) => {
                  const active =
                    c.key === chainActions.activeSuiKey || c.key === chainActions.activeEvmKey;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => chainActions.onSelect(c)}
                      title={c.label}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-1.5 text-xs transition ${
                        active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.colorVar }}
                      />
                      <span className="truncate">{c.label}</span>
                      {c.readonly && (
                        <span className="ml-auto font-mono text-[9px] uppercase text-faint">read</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {chainActions.error && (
                <p className="mt-2 px-1 text-[11px] text-alarm-text">{chainActions.error}</p>
              )}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
