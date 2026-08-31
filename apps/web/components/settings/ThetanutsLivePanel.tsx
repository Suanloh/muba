"use client";
/**
 * Thetanuts V4 OptionBook — realtime panel.
 *
 * Subscribes to the live OptionBook feed and renders each tick as it arrives:
 * implied volatility (with a tiny sparkline), delta, premium, expiry and an
 * honest provenance badge (LIVE green / SIMULATED amber). The feed polls the
 * real book for ETH/BTC when a Base RPC is configured; SUI (and any
 * unreachable book) streams the labeled simulated walk — never presented as
 * live data.
 */
import { useEffect, useRef, useState } from "react";
import type { RealtimeOptionTick } from "@mova/integrations";
import { thetanutsLiveFeed } from "@/lib/thetanuts/live-feed";
import { Badge, Card } from "@/components/ui";

const HISTORY = 24;

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-[10px] text-slate-400">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 56;
  const h = 18;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const tone = values[values.length - 1]! >= values[0]! ? "text-emerald-500" : "text-rose-500";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-[18px] w-14 ${tone}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ThetanutsLivePanel() {
  const [ticks, setTicks] = useState<RealtimeOptionTick[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());
  const bufferRef = useRef<RealtimeOptionTick[]>([]);

  useEffect(() => {
    const unsub = thetanutsLiveFeed.subscribe((tick) => {
      bufferRef.current = [...bufferRef.current.slice(-HISTORY), tick];
      setTicks(bufferRef.current);
      setLiveError(thetanutsLiveFeed.lastLiveError);
    });
    return unsub;
  }, []);

  const latest = new Map<string, RealtimeOptionTick>();
  for (const t of ticks) latest.set(t.asset, t);
  const history = new Map<string, number[]>();
  for (const t of ticks) {
    const arr = history.get(t.asset) ?? [];
    arr.push(t.impliedVol);
    history.set(t.asset, arr);
  }

  const assets = Array.from(latest.keys());
  const hasLive = ticks.some((t) => !t.simulated);
  const lastAt = ticks.length > 0 ? new Date(ticks[ticks.length - 1]!.at).toLocaleTimeString() : null;

  return (
    <Card
      title="Thetanuts OptionBook · realtime"
      subtitle="Live implied vol / delta streamed from the V4 book — honest provenance on every tick."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={hasLive ? "green" : "blue"}>
            {hasLive ? "Live book" : "Simulated realtime (dev)"}
          </Badge>
          <span className="font-mono text-[11px] text-slate-400">
            {ticks.length} tick{ticks.length === 1 ? "" : "s"} · every ~8s
          </span>
          {lastAt && <span className="text-[11px] text-slate-400">last {lastAt}</span>}
          <span className="ml-auto font-mono text-[10px] text-slate-400">
            stream since {new Date(startedAt).toLocaleTimeString()}
          </span>
        </div>

        {liveError && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
            Live book unreachable ({liveError.slice(0, 120)}) — streaming labeled simulated ticks.
          </p>
        )}

        {assets.length === 0 ? (
          <p className="text-xs text-slate-500">Waiting for the first tick…</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Asset</th>
                  <th className="px-3 py-1.5 font-medium">IV</th>
                  <th className="px-3 py-1.5 font-medium">IV trend</th>
                  <th className="px-3 py-1.5 font-medium">Δ</th>
                  <th className="px-3 py-1.5 text-right font-medium">Premium (8dp)</th>
                  <th className="px-3 py-1.5 text-right font-medium">Expiry</th>
                  <th className="px-3 py-1.5 text-right font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assets.map((asset) => {
                  const t = latest.get(asset)!;
                  return (
                    <tr key={asset}>
                      <td className="px-3 py-1.5 font-mono font-medium text-slate-700">{asset}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-700">{fmtPct(t.impliedVol)}</td>
                      <td className="px-3 py-1.5">
                        <Sparkline values={history.get(asset) ?? [t.impliedVol]} />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-slate-600">{t.delta.toFixed(3)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                        {t.simulated ? "—" : t.price}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">
                        {t.expiry ? new Date(t.expiry).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Badge tone={t.simulated ? "amber" : "green"}>
                          {t.simulated ? "SIMULATED" : "LIVE"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          ETH/BTC stream the real Thetanuts V4 book when a Base RPC is configured (
          <code className="font-mono">NEXT_PUBLIC_THETANUTS_RPC</code>). Assets without a live book
          (SUI, USDC, MOV) stream a deterministic simulated walk labeled{" "}
          <span className="font-medium">SIMULATED</span> — dev/demo only, refused on mainnet.
          Hedging remains a recommendation behind the same human-approval gate as the payment.
        </p>
      </div>
    </Card>
  );
}
