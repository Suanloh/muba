"use client";
/**
 * MOVA Phase 6 — Risk & Hedging panel.
 *
 * Renders the deterministic financial risk assessment and the route-vs-route+
 * hedge comparison for the active payment, feeding MOVA's final payment
 * recommendation. Data-source labels are honest: live Thetanuts, static dev
 * (simulated), or unavailable — never a fabricated live quote.
 */
import { useAppStore } from "@/lib/store/app-store";
import { formatMoney, shortId } from "@/lib/pipeline/format";
import type { HedgeDataSource } from "@mova/types";
import { Badge, Card } from "./ui";

function bandTone(band: string): "green" | "blue" | "amber" | "red" {
  switch (band) {
    case "LOW":
      return "green";
    case "MEDIUM":
      return "blue";
    case "HIGH":
      return "amber";
    default:
      return "red";
  }
}

function sourceLabel(source: HedgeDataSource | undefined): { label: string; tone: "green" | "amber" | "slate" } {
  switch (source) {
    case "LIVE":
      return { label: "Live Thetanuts", tone: "green" };
    case "STATIC_DEV":
      return { label: "Static dev (simulated)", tone: "amber" };
    case "UNAVAILABLE":
      return { label: "Unavailable", tone: "slate" };
    default:
      return { label: "Unknown", tone: "slate" };
  }
}

export function RiskAssessmentPanel() {
  const { records, activeRecordId, riskViews } = useAppStore();
  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;
  const view = record ? riskViews[record.id] : undefined;

  if (!record) {
    return (
      <Card title="Risk & hedging" subtitle="Phase 6 — deterministic risk assessment + Thetanuts hedge evaluation.">
        <p className="text-sm text-slate-500">
          No payment yet. Create one to see MOVA score financial risk, decide whether a hedge is needed, and compare the route with vs without the hedge.
        </p>
      </Card>
    );
  }

  if (!view) {
    return (
      <Card
        title="Risk & hedging"
        subtitle={
          <>
            <span className="font-mono">{shortId(record.id)}</span> · {formatMoney(record.amount)}
          </>
        }
      >
        <p className="text-sm text-slate-500">
          Assessing financial risk and hedge options for this payment… (deterministic, dev/demo data).
        </p>
      </Card>
    );
  }

  const rec = view.recommendation;
  const risk = rec.risk;
  const hedge = rec.hedge;
  const src = sourceLabel(hedge.dataSource);

  return (
    <Card
      title="Risk & hedging"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · MOVA final recommendation
        </>
      }
    >
      {/* Headline */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={bandTone(risk.band)}>
          {risk.band} risk · {risk.score}/100
        </Badge>
        <Badge tone={rec.decision === "BLOCK" ? "red" : rec.decision === "REVIEW" ? "amber" : "green"}>
          {rec.decision}
        </Badge>
        {rec.hedged ? (
          <Badge tone="violet">Hedged · {hedge.strategy}</Badge>
        ) : (
          <Badge tone="slate">No hedge</Badge>
        )}
        <Badge tone={src.tone}>{src.label}</Badge>
      </div>

      {/* Final recommendation */}
      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
        <p className="font-medium text-slate-700">
          Final total cost: {formatMoney(rec.totalCost)}
          {rec.hedged && (
            <span className="text-slate-500"> (route {formatMoney(hedge.withoutHedge)} + hedge {formatMoney(hedge.delta)})</span>
          )}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          <span className="font-medium">{risk.band} risk · {risk.score}/100</span> → {rec.decision}
          {rec.hedged ? ` · hedged via ${hedge.strategy}` : ""}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{hedge.reason}</p>
      </div>

      {/* Risk signals */}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Risk signals</h3>
      <div className="mt-1.5 space-y-1.5">
        {risk.signals.map((s) => (
          <div key={s.signalId} className="rounded-md border border-slate-100 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-700">{s.signalId}</span>
              <span className="text-xs text-slate-500">{s.contribution}/100</span>
            </div>
            <p className="text-xs text-slate-500">{s.description}</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sky-500"
                style={{ width: `${Math.min(100, s.contribution)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">value: {s.value}</p>
          </div>
        ))}
      </div>

      {/* Hedge evaluation */}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Route vs route + hedge
      </h3>
      <div className="mt-1.5 overflow-hidden rounded-lg border border-slate-100">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Route</th>
              <th className="px-3 py-1.5 font-medium">Decision</th>
              <th className="px-3 py-1.5 text-right font-medium">Without</th>
              <th className="px-3 py-1.5 text-right font-medium">With hedge</th>
              <th className="px-3 py-1.5 text-right font-medium">Exposure removed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {view.comparisons.map((c) => (
              <tr key={c.routeNo}>
                <td className="px-3 py-1.5 font-mono text-slate-700">{c.routeNo}</td>
                <td className="px-3 py-1.5">
                  <Badge tone={c.hedgeDecision === "HEDGE" ? "violet" : "slate"}>{c.hedgeDecision}</Badge>
                </td>
                <td className="px-3 py-1.5 text-right text-slate-600">{formatMoney(c.withoutHedge)}</td>
                <td className="px-3 py-1.5 text-right text-slate-600">{formatMoney(c.withHedge)}</td>
                <td className="px-3 py-1.5 text-right text-slate-600">{formatMoney(c.exposureReduction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{hedge.reason}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        Hedging is a recommendation only — executing a hedge is itself value movement and would require the same human approval gate as the payment.
      </p>
    </Card>
  );
}
