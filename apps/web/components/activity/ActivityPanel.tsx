"use client";
/**
 * Activity panel — the structured transaction history (Point 3 of the
 * redesign). Real-time status indicators (Pending/Success/Failed), gas + fees,
 * timestamps, transaction categories, block-explorer links, grouping by day,
 * and a privacy mask that follows the global balance-privacy toggle.
 */
import { useMemo, useState } from "react";
import { failureLabel } from "@mova/core";
import { useAppStore } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { formatDateTime, formatMoney, shortAddress, shortId } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "@/components/ui";

type StatusFilter = "all" | "pending" | "success" | "failed";
type KindFilter = "all" | "payment" | "hedged" | "simulated" | "real";

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ActivityPanel() {
  const { records, receipts, plans, privacyHidden, setView } = useAppStore();
  const { appNetwork } = useMovaWallet();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (status === "pending" && !(r.state !== "SETTLED" && r.state !== "FAILED")) return false;
      if (status === "success" && r.state !== "SETTLED") return false;
      if (status === "failed" && r.state !== "FAILED") return false;

      const plan = plans[r.id];
      const hedged = !!plan?.recommendation?.hedged;
      const simulated = r.settlement?.simulated === true;
      const real = r.settlement?.simulated === false;
      if (kind === "hedged" && !hedged) return false;
      if (kind === "simulated" && !simulated) return false;
      if (kind === "real" && !real) return false;

      if (q) {
        const hay = `${r.id} ${r.recipient.value} ${r.amount.asset} ${r.state}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, plans, status, kind, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const key = dayLabel(r.createdAt);
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    return [...groups.entries()];
  }, [filtered]);

  const statusChip = (value: StatusFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setStatus(value)}
      aria-pressed={status === value}
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition ${
        status === value
          ? "border-signal-border bg-signal-bg text-signal-text"
          : "border-hairline text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
  const kindChip = (value: KindFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setKind(value)}
      aria-pressed={kind === value}
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition ${
        kind === value
          ? "border-signal-border bg-signal-bg text-signal-text"
          : "border-hairline text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  if (records.length === 0) {
    return (
      <Card title="Activity" subtitle="Records & receipts owned by your address.">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-muted">No transactions yet.</p>
          <Button variant="primary" onClick={() => setView("home")}>
            Make a payment
          </Button>
        </div>
      </Card>
    );
  }

  const mask = (s: string) => (privacyHidden ? "••••" : s);

  return (
    <Card
      title="Activity"
      subtitle={`${filtered.length} of ${records.length} records · bound to your address`}
    >
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "pending", "success", "failed"] as StatusFilter[]).map((v) =>
            statusChip(v, v),
          )}
        </div>
        <span className="mx-1 hidden h-4 w-px bg-hairline sm:block" aria-hidden="true" />
        <div className="flex flex-wrap gap-1.5">
          {(["all", "payment", "hedged", "simulated", "real"] as KindFilter[]).map((v) =>
            kindChip(v, v),
          )}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search id / recipient / asset…"
          aria-label="Search transactions"
          className="ml-auto w-full rounded-[10px] border border-hairline bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink placeholder:text-faint focus:border-hairline-strong sm:w-56"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-sm text-muted">No transactions match these filters.</p>
      ) : (
        <div className="divide-y divide-hairline">
          {grouped.map(([day, rows]) => (
            <section key={day} aria-label={day}>
              <p className="sticky top-16 z-10 -mx-5 border-b border-hairline bg-surface px-5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                {day}
              </p>
              {rows.map((r) => {
                const receipt = receipts.find((rc) => rc.paymentRecordId === r.id);
                const plan = plans[r.id];
                const failure = r.execution?.failure ?? null;
                const pending = r.state !== "SETTLED" && r.state !== "FAILED";
                const expanded = expandedId === r.id;
                const hedged = !!plan?.recommendation?.hedged;
                const simulated = r.settlement?.simulated === true;
                const real = r.settlement?.simulated === false;
                const digest = r.settlement?.txDigest ?? null;

                return (
                  <div key={r.id} className="py-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-mono text-xs text-muted">{shortId(r.id)}</span>
                          <Badge tone={pending ? "amber" : r.state === "SETTLED" ? "green" : "red"}>
                            <span className="flex items-center gap-1">
                              {pending && <span className="mova-pulse inline-block h-1.5 w-1.5 rounded-full bg-ember-text" aria-hidden="true" />}
                              {pending ? "Pending" : r.state}
                            </span>
                          </Badge>
                          {hedged && <Badge tone="violet">hedged</Badge>}
                          {simulated && <Badge tone="slate">simulated</Badge>}
                          {real && <Badge tone="green">real on-chain</Badge>}
                        </div>
                        <p className="mt-1 truncate text-sm text-ink">
                          <span className="font-mono font-medium">{mask(formatMoney(r.amount))}</span>
                          <span className="text-muted"> → </span>
                          <span className="text-muted">{shortAddress(r.recipient.value, 8, 6)}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-faint">
                          <span title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                          {plan && (
                            <span>
                              Route #<span className="font-mono">{plan.preview.route.routeNo}</span> ·{" "}
                              <span className="font-mono">{plan.preview.route.summary.legOrder.join("→")}</span> ·{" "}
                              fees <span className="font-mono">{mask(formatMoney(plan.preview.route.totalFee))}</span>
                            </span>
                          )}
                          {r.settlement?.error && !failure && (
                            <span className="text-ember-text">{r.settlement.error}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {digest ? (
                          <a
                            href={`https://suiscan.xyz/${appNetwork ?? "testnet"}/tx/${digest}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs text-signal-text underline decoration-dotted hover:text-signal"
                          >
                            {shortAddress(digest, 8, 6)} ↗
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-faint">
                            {real ? "digest pending" : "simulated"}
                          </span>
                        )}
                        <span className="text-[10px] text-faint">{expanded ? "hide" : "details"} ▾</span>
                      </div>
                    </button>

                    {expanded && (
                      <div className="mt-2 rounded-[12px] border border-hairline bg-surface-2 p-3 text-xs">
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          <div><span className="text-faint">Record </span><span className="font-mono text-ink">{r.id}</span></div>
                          <div><span className="text-faint">Created </span><span className="text-ink">{formatDateTime(r.createdAt)}</span></div>
                          {r.recipient && (
                            <div className="sm:col-span-2"><span className="text-faint">Recipient </span><span className="break-all font-mono text-ink">{r.recipient.value}</span></div>
                          )}
                          {plan && (
                            <div className="sm:col-span-2">
                              <span className="text-faint">Plan digest </span>
                              <span className="break-all font-mono text-ink">{plan.spec.planDigest}</span>
                            </div>
                          )}
                          {receipt && (
                            <div><span className="text-faint">Receipt </span><span className="font-mono text-ledger-text">{shortId(receipt.id, 10)}</span></div>
                          )}
                          {r.approval?.decision && (
                            <div><span className="text-faint">Approval </span><span className="font-mono text-ink">{r.approval.decision}</span></div>
                          )}
                          {failure && (
                            <div className="sm:col-span-2">
                              <span className="text-faint">Failure </span>
                              <span className="text-alarm-text">{failureLabel(failure.code)}: {failure.message}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
