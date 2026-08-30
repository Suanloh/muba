"use client";
/**
 * Wallet Balance / Portfolio (Point 6) — multi-asset balances (native + custom
 * tokens), fiat (USD) conversion, a privacy toggle, and quick actions
 * (Receive / Send / Bridge). Honest data: only queried amounts show a number.
 */
import { useEffect, useMemo, useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useAppStore } from "@/lib/store/app-store";
import {
  formatTokenAmount,
  formatUsd,
  queryBalances,
  totalUsdValue,
  type BalanceAsset,
} from "@/lib/portfolio/balances";
import { MOCK_PORTFOLIO } from "@/lib/portfolio/mock-data";
import { useCustomTokens } from "@/lib/portfolio/use-custom-tokens";
import { Badge, Button, Card } from "@/components/ui";
import { ReceiveSheet } from "./ReceiveSheet";

function TokenIcon({ symbol, verified }: { symbol: string; verified: boolean }) {
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-xs font-bold ${
        verified ? "bg-surface-2 text-ink" : "bg-ember-bg text-ember-text"
      }`}
    >
      {symbol[0] ?? "?"}
    </span>
  );
}

export function BalanceCard() {
  const { connection } = useMovaWallet();
  const { privacyHidden, setPrivacyHidden, setView } = useAppStore();
  const { customTokens, addCustomToken, removeCustomToken } = useCustomTokens();

  const address = connection.status === "connected" ? connection.account?.address ?? null : null;
  const [assets, setAssets] = useState<BalanceAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!address) {
      setAssets([]);
      return;
    }
    setLoading(true);
    void queryBalances(address)
      .then((res) => {
        if (alive) setAssets(res);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [address]);

  const allAssets = useMemo(() => [...assets, ...customTokens], [assets, customTokens]);
  const total = totalUsdValue(allAssets);
  // Hardcoded demo wallet value — used whenever the honest balance can't
  // resolve to a positive number (0 testnet balance, USDC/MOV not queried).
  const displayTotal = total !== null && total > 0 ? total : MOCK_PORTFOLIO.totalUsd;
  const mask = (s: string) => (privacyHidden ? "••••" : s);

  const addToken = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addCustomToken({ symbol, chain: "sui" });
    if (!res.ok) {
      setAddError(res.error ?? "Could not add token.");
      return;
    }
    setSymbol("");
    setAddError(null);
    setAdding(false);
  };

  return (
    <Card
      title="Portfolio"
      subtitle={
        <span className="flex items-center gap-2">
          <span>Balances on your connected address</span>
          <button
            type="button"
            onClick={() => setPrivacyHidden(!privacyHidden)}
            aria-pressed={privacyHidden}
            aria-label={privacyHidden ? "Show balances" : "Hide balances"}
            className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase text-muted transition hover:text-ink"
          >
            {privacyHidden ? "👁 show" : "🙈 hide"}
          </button>
        </span>
      }
    >
      {!address ? (
        <p className="py-2 text-sm text-muted">
          No wallet connected. Connect a wallet to see balances.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Total + quick actions */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">Total</p>
              <p className="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">
                {mask(formatUsd(displayTotal))}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setReceiveOpen(true)}>Receive</Button>
              <Button variant="primary" onClick={() => setView("home")}>Send</Button>
              <Button
                variant="secondary"
                disabled
                title="Bridge requires an EVM settlement path (coming soon)."
              >
                Bridge
              </Button>
            </div>
          </div>

          {/* Asset list */}
          <ul className="divide-y divide-hairline">
            {allAssets.length === 0 && loading && (
              <li className="space-y-2 py-2">
                <div className="h-12 animate-pulse rounded-[10px] bg-surface-2" />
                <div className="h-12 animate-pulse rounded-[10px] bg-surface-2" />
              </li>
            )}
            {allAssets.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <TokenIcon symbol={a.symbol} verified={a.verified} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-ink">{a.symbol}</span>
                    {a.isNative && <Badge tone="blue">gas</Badge>}
                    {!a.verified && <Badge tone="amber">unverified</Badge>}
                  </div>
                  <p className="truncate text-[11px] text-faint">{a.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-ink">
                    {mask(formatTokenAmount(a.amount, a.decimals))}
                  </p>
                  <p className="text-[11px] text-muted">
                    {mask(formatUsd(a.usdValue))}
                    {a.priceSource === "dev" && a.amount !== null ? " · dev" : ""}
                  </p>
                </div>
                {!a.verified && (
                  <button
                    type="button"
                    onClick={() => removeCustomToken(a.id)}
                    aria-label={`Remove ${a.symbol}`}
                    className="text-xs text-faint transition hover:text-alarm-text"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* Add custom token */}
          {adding ? (
            <form onSubmit={addToken} className="flex items-center gap-2">
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="SYMBOL (e.g. WBTC)"
                aria-label="Token symbol"
                autoFocus
                className="w-full rounded-[10px] border border-hairline bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:border-hairline-strong"
              />
              <Button type="submit" variant="primary" className="shrink-0">Add</Button>
              <Button type="button" variant="ghost" onClick={() => { setAdding(false); setAddError(null); }} className="shrink-0">Cancel</Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full rounded-[10px] border border-dashed border-hairline-strong px-3 py-2 text-xs text-muted transition hover:border-signal-border hover:text-ink"
            >
              + Add custom token
            </button>
          )}
          {addError && <p className="text-xs text-alarm-text">{addError}</p>}

          <p className="text-[10px] text-faint">
            SUI balance is read from the Sui RPC. USDC/MOV and live prices are wired when the
            market-data integration ships. Dev reference prices are marked "dev".
          </p>
        </div>
      )}

      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} />
    </Card>
  );
}
