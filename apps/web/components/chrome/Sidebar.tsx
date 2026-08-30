"use client";
/**
 * Left sidebar (desktop, lg+) — primary destinations, a compact ecosystem
 * rail, and a network/version footer. Collapsible to an icon rail (persisted).
 * On <1024px the multi-ecosystem bottom bar takes over (§2 of the redesign).
 */
import { useEffect, useState } from "react";
import { useAppStore, type AppView } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { ALL_CHAINS } from "@/lib/chrome/chains";
import { useChainActions } from "./ChainSwitcher";

function Icon({ d, extra }: { d: string; extra?: string }) {
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

const NAV: { id: AppView; label: string; hint: string; d: string; extra?: string }[] = [
  { id: "home", label: "Home", hint: "Dashboard & pay", d: "M3 10.5 12 3l9 7.5", extra: "M5 9.5V21h14V9.5" },
  { id: "activity", label: "Activity", hint: "Transaction history", d: "M4 6h16M4 12h10M4 18h7" },
  { id: "portfolio", label: "Portfolio", hint: "Balances", d: "M4 6h16v12H4z", extra: "M8 10h8M8 14h5" },
  { id: "settings", label: "Settings", hint: "Sound · privacy · demo", d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", extra: "M19 13.5v-3l2-1-1-2-2.3.7a7 7 0 0 0-1.2-.7L16 4.5h-2l-.5 2.3a7 7 0 0 0-1.2.7L10 6.5 9 8.5l2 1v3l-2 1 1 2 2.3-.7a7 7 0 0 0 1.2.7l.5 2.5h2l.5-2.5a7 7 0 0 0 1.2-.7L19 17.5l1-2-2-1z" },
];

export function Sidebar() {
  const { view, setView } = useAppStore();
  const { appNetwork } = useMovaWallet();
  const chainActions = useChainActions();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("mova-rail") === "collapsed");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("mova-rail", next ? "collapsed" : "expanded");
    } catch {
      /* ignore */
    }
  };

  return (
    <aside
      className={`sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-hairline bg-surface/40 backdrop-blur lg:flex ${
        collapsed ? "w-16" : "w-60"
      } transition-[width] duration-200`}
    >
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {/* New payment primary action */}
        <button
          type="button"
          onClick={() => setView("home")}
          className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-signal bg-signal px-3 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <Icon d="M12 5v14M5 12h14" />
          {!collapsed && <span>New payment</span>}
        </button>

        {/* Primary nav */}
        <nav aria-label="Primary" className="space-y-1">
          {NAV.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`relative flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition ${
                  active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal" aria-hidden="true" />
                )}
                <Icon d={item.d} extra={item.extra} />
                {!collapsed && (
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="truncate">{item.label}</span>
                    <span className="truncate text-[10px] text-faint">{item.hint}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Ecosystem rail */}
        <section aria-label="Ecosystems">
          {!collapsed && (
            <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              Ecosystems
            </p>
          )}
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
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.colorVar }} />
                  {!collapsed && <span className="truncate">{c.label}</span>}
                  {!collapsed && c.readonly && (
                    <span className="ml-auto font-mono text-[9px] uppercase text-faint">read</span>
                  )}
                </button>
              );
            })}
          </div>
          {chainActions.error && !collapsed && (
            <p className="mt-2 px-1 text-[11px] text-alarm-text">{chainActions.error}</p>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-hairline px-3 py-3">
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-ledger-text" aria-hidden="true" />
          {!collapsed && (
            <span className="truncate font-mono text-[10px] text-faint">
              {appNetwork ? `sui:${appNetwork}` : "sui:—"} · v0.1
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`ml-auto flex h-6 w-6 items-center justify-center rounded-full border border-hairline text-faint transition hover:text-ink ${
              collapsed ? "ml-0" : ""
            }`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {collapsed ? <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /> : <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
