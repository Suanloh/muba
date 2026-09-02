"use client";
/**
 * MOVA Live payment flow — the unified, phase-based review & settle surface.
 *
 * One card, one story: the payment moves through six phases
 *
 *   Parse intent → Route → Compliance → Risk & hedging → Approval → Settle
 *
 * Design rules (from the UI refinement pass):
 *   1. Every phase collapses to ONE line by default; tap a phase to expand its
 *      detail. Nothing is hidden when expanded — the full deterministic data
 *      is one tap away.
 *   2. The live-run log is KEPT — the streaming entry feed from the unified
 *      pipeline (plan-review) is rendered in full at the bottom, auto-scrolled.
 *   3. Audit trail, notifications and the safety-boundary are NOT part of the
 *      live payment flow. They live only in the Activity view; this flow
 *      merely links out to "View full report".
 *   4. The user can choose WITH or WITHOUT hedge while making the payment
 *      (overrides the deterministic recommendation for display).
 *   5. Report generation (Activity → Audit trail) lets you pick WHICH payment
 *      to generate a report for.
 */
import { useEffect, useRef, useState } from "react";
import { failureLabel, failureUserMessage } from "@mova/core";
import type { PaymentPreview } from "@mova/types";
import { useAppStore } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import {
  STAGE_LABELS,
  type LiveRunEntry,
  type PlanReviewStage,
} from "@/lib/pipeline/plan-review";
import { formatDuration, formatMoney, shortAddress, shortId } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

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

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Real wall-clock span of a pipeline stage, from the live-run entry stream. */
function stageMs(entries: LiveRunEntry[], stage: PlanReviewStage): number | null {
  const es = entries.filter((e) => e.stage === stage);
  if (es.length < 2) return null;
  return Math.max(0, es[es.length - 1]!.at - es[0]!.at);
}

function fmtSec(ms: number | null): string {
  if (ms === null) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

const GLYPHS: Record<LiveRunEntry["kind"], { glyph: string; cls: string }> = {
  run: { glyph: "▸", cls: "text-signal-text" },
  ok: { glyph: "✓", cls: "text-ledger-text" },
  warn: { glyph: "!", cls: "text-ember-text" },
  fail: { glyph: "✕", cls: "text-alarm-text" },
  info: { glyph: "·", cls: "text-faint" },
};

function RunRow({ e }: { e: LiveRunEntry }) {
  const g = GLYPHS[e.kind];
  return (
    <li className="flex items-baseline gap-2 px-3 py-1.5 font-mono text-[12px]">
      <span className="shrink-0 text-[10px] text-faint">{fmtClock(e.at)}</span>
      <span className={`w-3 shrink-0 text-center ${g.cls}`} aria-hidden="true">
        {g.glyph}
      </span>
      <span className="min-w-0 flex-1 text-muted">
        <span className={e.kind === "ok" || e.kind === "fail" ? "text-ink" : ""}>{e.text}</span>
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-[0.06em] text-faint">
        {STAGE_LABELS[e.stage]}
      </span>
    </li>
  );
}

/**
 * The live-run streaming log — the one place every pipeline event is kept.
 * Auto-scrolled by the parent as new entries arrive; never truncated.
 */
function LiveLog({
  entries,
  running,
  done,
  logRef,
}: {
  entries: LiveRunEntry[];
  running: boolean;
  done: boolean;
  logRef: React.RefObject<HTMLOListElement | null>;
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-2">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          Live run · log
        </span>
        {done && (
          <span className="font-mono text-[10px] text-ledger-text">
            {entries.length} events · pipeline complete
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-4 text-center text-xs text-faint">
          The streaming log appears here as the pipeline runs.
        </p>
      ) : (
        <ol ref={logRef} className="max-h-48 space-y-px overflow-y-auto py-1.5">
          {entries.map((e) => (
            <RunRow key={e.id} e={e} />
          ))}
          {running && (
            <li className="flex items-center gap-2 px-3 py-1.5 font-mono text-[12px] text-faint">
              <span className="h-3 w-3 animate-spin rounded-full border border-hairline-strong border-t-signal" />
              processing…
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

export function LivePaymentFlow() {
  const {
    records,
    plans,
    planRun,
    activeRecordId,
    acknowledged,
    setAcknowledged,
    hedgeChoice,
    setHedgeChoice,
    approve,
    reject,
    execute,
    setView,
  } = useAppStore();
  const { connection } = useMovaWallet();

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"approve" | "reject" | "execute" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement | null>(null);

  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;
  const plan = record ? plans[record.id] : undefined;
  const preview: PaymentPreview | null = plan?.preview ?? null;

  const connected = connection.status === "connected";
  const running = planRun.status === "running";

  // Auto-scroll the live log as entries stream in.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [planRun.entries.length]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runAction = async (action: "approve" | "reject" | "execute") => {
    if (!record) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "approve") await approve(record.id);
      else if (action === "reject") await reject(record.id);
      else await execute(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // No payment at all — empty state.
  if (!record) {
    return (
      <Card
        title="Live payment flow"
        subtitle="Parse intent → route → compliance → risk & hedge → approval → settle — every phase collapses to one line, tap to expand."
      >
        <div className="rounded-[12px] border border-dashed border-hairline-strong px-4 py-6 text-center">
          <p className="text-sm text-muted">
            No payment yet. Create one (chat or QR) to watch the unified pipeline run end-to-end.
          </p>
          <p className="mt-1 font-mono text-[11px] text-faint">
            parse intent → route → compliance → risk &amp; hedging → approval → settle
          </p>
        </div>
      </Card>
    );
  }

  // Payment exists but the plan is still building — stream progress/log.
  if (!plan || !preview) {
    return (
      <Card
        title="Live payment flow"
        subtitle={
          <>
            <span className="font-mono">{shortId(record.id)}</span> · {record.state} · building plan…
          </>
        }
      >
        <div className="rounded-[12px] border border-dashed border-hairline-strong px-4 py-4 text-center">
          <p className="text-sm text-muted">
            Building the deterministic plan for {shortId(record.id)} — the pipeline is running.
          </p>
        </div>
        <div className="mt-3">
          <LiveLog entries={planRun.entries} running={running} done={planRun.status === "done"} logRef={logRef} />
        </div>
      </Card>
    );
  }

  const rec = plan.recommendation;
  const cmp = rec.hedge; // selected route with-vs-without-hedge comparison
  const risk = rec.risk;
  const route = preview.route;

  // Hedge exposure math (derived deterministically from the engine output):
  // the hedged exposure is the engine's risk score (/100); the unhedged
  // exposure is the score scaled up by 1/(1 − exposureReductionRatio).
  const withExposure = risk.score;
  const ratio = cmp.exposureReductionRatio;
  const withoutExposure =
    ratio > 0 && ratio < 1 ? Math.round(withExposure / (1 - ratio)) : withExposure;
  const hedgeChoiceHere = hedgeChoice[record.id] ?? (rec.hedged ? "HEDGE" : "NO_HEDGE");
  const hedged = hedgeChoiceHere === "HEDGE";
  const exposure = hedged ? withExposure : withoutExposure;
  const approvalCost = hedged ? cmp.withHedge : cmp.withoutHedge;

  const recipientName =
    preview.recipient.name ?? shortAddress(preview.suiDestination, 8, 6);
  const title = `${preview.action === "TRANSFER" ? "Send" : "Pay"} ${recipientName} · ${formatMoney(preview.amount)}`;

  const statusMeta = (() => {
    switch (planRun.status) {
      case "running":
        return { label: "Running", tone: "blue" as const };
      case "done":
        return { label: "Done", tone: "green" as const };
      case "failed":
        return { label: "Failed", tone: "red" as const };
      default:
        return { label: "Idle", tone: "slate" as const };
    }
  })();

  const awaiting = record.state === "AWAITING_APPROVAL";
  const approved = record.state === "APPROVED";
  const executing = record.state === "EXECUTING";
  const settled = record.state === "SETTLED";
  const failed = record.state === "FAILED";
  const blocked =
    preview.compliance.decision === "BLOCK" || preview.risk.decision === "BLOCK";
  const isAcknowledged = acknowledged[record.id] ?? false;

  // ---- Phase definitions (each: one line collapsed, detail when expanded) --
  const phases: {
    id: string;
    label: string;
    summary: string;
    duration: string;
    glyph: string;
    glyphCls: string;
    detail: React.ReactNode;
  }[] = [
    {
      id: "parse",
      label: "Parse intent",
      summary: `${formatMoney(preview.amount)} to ${recipientName} on ${plan.spec.network}`,
      duration: fmtSec(stageMs(planRun.entries, "strategy")),
      glyph: plan ? "✓" : "·",
      glyphCls: plan ? "text-ledger-text" : "text-faint",
      detail: (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Field label="Action" value={preview.action} />
          <Field label="Amount" value={formatMoney(preview.amount)} />
          <Field label="Recipient" value={preview.recipient.value} mono />
          <Field label="Sui destination" value={shortAddress(preview.suiDestination, 12, 10)} mono />
          <Field label="Network" value={plan.spec.network} />
          <Field label="Source text" value={record.rawText.slice(0, 48)} />
        </dl>
      ),
    },
    {
      id: "route",
      label: "Route",
      summary: `#${route.routeNo} · ${route.summary.legOrder.join(" → ")}`,
      duration: fmtSec(stageMs(planRun.entries, "strategy")),
      glyph: plan ? "✓" : "·",
      glyphCls: plan ? "text-ledger-text" : "text-faint",
      detail: <RouteDetail plan={plan} />,
    },
    {
      id: "compliance",
      label: "Compliance",
      summary: complianceSummary(preview),
      duration: fmtSec(stageMs(planRun.entries, "compliance")),
      glyph: preview.compliance.decision === "ALLOW" ? "✓" : preview.compliance.decision === "REVIEW" ? "!" : "✕",
      glyphCls:
        preview.compliance.decision === "ALLOW"
          ? "text-ledger-text"
          : preview.compliance.decision === "REVIEW"
            ? "text-ember-text"
            : "text-alarm-text",
      detail: (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={preview.compliance.decision === "ALLOW" ? "green" : preview.compliance.decision === "REVIEW" ? "amber" : "red"}>
              {preview.compliance.decision}
            </Badge>
            <span className="text-faint">risk {preview.compliance.riskScore}/100</span>
            {preview.compliance.failClosed && <Badge tone="red">fail-closed</Badge>}
          </div>
          <p className="text-muted">{preview.compliance.explanation}</p>
          {preview.compliance.matchedLists.length > 0 && (
            <p className="text-alarm-text">
              Matched: {preview.compliance.matchedLists.join(", ")}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "risk",
      label: "Risk and hedging",
      summary: `Exposure ${exposure} of 100 · ${hedged ? "hedge applied" : "no hedge"}`,
      duration: fmtSec(stageMs(planRun.entries, "risk")),
      glyph: risk.decision === "BLOCK" ? "✕" : risk.decision === "REVIEW" ? "!" : "✓",
      glyphCls:
        risk.decision === "BLOCK"
          ? "text-alarm-text"
          : risk.decision === "REVIEW"
            ? "text-ember-text"
            : "text-ledger-text",
      detail: (
        <RiskHedgeDetail
          score={risk.score}
          band={risk.band}
          bandTone={bandTone(risk.band)}
          decision={risk.decision}
          signals={risk.signals}
          strategy={cmp.strategy}
          delta={cmp.delta}
          withHedge={cmp.withHedge}
          withoutHedge={cmp.withoutHedge}
          exposureReduction={cmp.exposureReduction}
          dataSource={cmp.dataSource}
          hedged={hedged}
          withExposure={withExposure}
          withoutExposure={withoutExposure}
          onHedgeChange={(v) => setHedgeChoice(record.id, v)}
        />
      ),
    },
    {
      id: "approval",
      label: "Approval",
      summary: approvalSummary(record.state, blocked),
      duration: "",
      glyph: settled || approved ? "✓" : failed ? "✕" : awaiting ? "!" : "·",
      glyphCls:
        settled || approved
          ? "text-ledger-text"
          : failed
            ? "text-alarm-text"
            : awaiting
              ? "text-ember-text"
              : "text-faint",
      detail: (
        <ApprovalDetail
          awaiting={awaiting}
          approved={approved}
          failed={failed}
          blocked={blocked}
          isAcknowledged={isAcknowledged}
          connected={connected}
          busy={busy}
          error={error}
          amount={formatMoney(preview.amount)}
          destination={shortAddress(preview.suiDestination, 10, 8)}
          network={plan.spec.network}
          routeNo={route.routeNo}
          settlement={preview.expectedSettlement}
          digest={preview.planDigest}
          cost={formatMoney(approvalCost)}
          hedged={hedged}
          onAck={(v) => setAcknowledged(record.id, v)}
          onApprove={() => void runAction("approve")}
          onReject={() => void runAction("reject")}
        />
      ),
    },
    {
      id: "settle",
      label: "Settle",
      summary: settleSummary(record, executing, settled, failed),
      duration: "",
      glyph: settled ? "✓" : executing ? "·" : failed ? "✕" : "·",
      glyphCls: settled ? "text-ledger-text" : executing ? "text-signal-text" : failed ? "text-alarm-text" : "text-faint",
      detail: (
        <SettleDetail
          record={record}
          approved={approved}
          settled={settled}
          executing={executing}
          failed={failed}
          connected={connected}
          busy={busy}
          onExecute={() => void runAction("execute")}
        />
      ),
    },
  ];

  return (
    <Card
      title={title}
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · {record.state} · digest{" "}
          <span className="font-mono text-signal-text">{preview.planDigest.slice(0, 12)}…</span>
          <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
            <span className="relative flex h-2 w-2">
              {running && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-signal opacity-60 mova-pulse" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  running
                    ? "bg-signal"
                    : statusMeta.tone === "green"
                      ? "bg-ledger"
                      : statusMeta.tone === "red"
                        ? "bg-alarm"
                        : "bg-faint"
                }`}
              />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
              {statusMeta.label}
            </span>
          </span>
        </>
      }
    >
      <div className="space-y-2">
        {phases.map((p) => (
          <PhaseRow
            key={p.id}
            id={p.id}
            label={p.label}
            summary={p.summary}
            duration={p.duration}
            glyph={p.glyph}
            glyphCls={p.glyphCls}
            open={open.has(p.id)}
            onToggle={() => toggle(p.id)}
          >
            {p.detail}
          </PhaseRow>
        ))}

        {/* ---- Live-run log — KEPT, never cut ---- */}
        <LiveLog
          entries={planRun.entries}
          running={running}
          done={planRun.status === "done"}
          logRef={logRef}
        />

        {/* Footer — report lives in Activity, not in the flow. */}
        <div className="flex items-center justify-end pt-1">
          <button
            onClick={() => setView("activity")}
            className="text-xs text-signal-text underline decoration-dotted underline-offset-2 hover:opacity-80"
          >
            View full report ↗
          </button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Collapsible phase row — ONE line by default, tap to expand
// ---------------------------------------------------------------------------

function PhaseRow({
  id,
  label,
  summary,
  duration,
  glyph,
  glyphCls,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  summary: string;
  duration: string;
  glyph: string;
  glyphCls: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`phase-${id}`}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
      >
        <span className={`w-4 shrink-0 text-center font-mono text-[13px] ${glyphCls}`} aria-hidden="true">
          {glyph}
        </span>
        <span className="shrink-0 text-[13px] font-medium text-ink">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{summary}</span>
        {duration && (
          <span className="shrink-0 font-mono text-[11px] text-faint">{duration}</span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-faint" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div id={`phase-${id}`} className="border-t border-hairline px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className={`text-right text-muted ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase detail bodies
// ---------------------------------------------------------------------------

function RouteDetail({ plan }: { plan: NonNullable<ReturnType<typeof useAppStore>["plans"][string]> }) {
  const routes = plan.optimization.routes;
  const savings = plan.optimization.savings;
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-hairline">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left text-faint">
            <tr>
              <th className="px-3 py-1.5 font-medium">Route</th>
              <th className="px-3 py-1.5 font-medium">Legs</th>
              <th className="px-3 py-1.5 text-right font-medium">Fees</th>
              <th className="px-3 py-1.5 text-right font-medium">Total</th>
              <th className="px-3 py-1.5 text-right font-medium">Time</th>
              <th className="px-3 py-1.5 text-right font-medium">Reliability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {routes.map((r) => (
              <tr key={r.id} className={r.status === "SELECTED" ? "bg-signal-bg" : ""}>
                <td className="px-3 py-1.5 font-mono text-muted">
                  #{r.routeNo}
                  {r.status === "SELECTED" && (
                    <span className="ml-1.5 text-signal-text">· selected</span>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-muted">{r.summary.legOrder.join(" → ")}</td>
                <td className="px-3 py-1.5 text-right text-muted">{formatMoney(r.totalFee)}</td>
                <td className="px-3 py-1.5 text-right text-muted">{formatMoney(r.totalEstimatedCost)}</td>
                <td className="px-3 py-1.5 text-right text-muted">{formatDuration(r.estimatedTimeMs)}</td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {(r.reliability * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        Why: {routeReason(plan)}
      </p>
      {savings && !savings.selectedIsCheapest && (
        <p className="text-[11px] text-ledger-text">
          Selected saves {formatMoney(savings.estimatedSavings)} vs the most expensive route.
        </p>
      )}
    </div>
  );
}

function routeReason(plan: NonNullable<ReturnType<typeof useAppStore>["plans"][string]>): string {
  const sel = plan.optimization.selected;
  return sel
    ? `Route #${sel.routeNo} (${sel.summary.legOrder.join(" → ")}) ranked best of ${plan.optimization.routes.length} candidates. ${sel.selectionReason}`
    : "Best-ranked route chosen by the deterministic optimizer.";
}

function RiskHedgeDetail({
  score,
  band,
  bandTone: tone,
  decision,
  signals,
  strategy,
  delta,
  withHedge,
  withoutHedge,
  exposureReduction,
  dataSource,
  hedged,
  withExposure,
  withoutExposure,
  onHedgeChange,
}: {
  score: number;
  band: string;
  bandTone: "green" | "blue" | "amber" | "red";
  decision: string;
  signals: { signalId: string; description: string; contribution: number; value: string }[];
  strategy: string;
  delta: { amount: string; asset: string };
  withHedge: { amount: string; asset: string };
  withoutHedge: { amount: string; asset: string };
  exposureReduction: { amount: string; asset: string };
  dataSource: string;
  hedged: boolean;
  withExposure: number;
  withoutExposure: number;
  onHedgeChange: (v: "HEDGE" | "NO_HEDGE") => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>
          {band} risk · {score}/100
        </Badge>
        <Badge tone={decision === "BLOCK" ? "red" : decision === "REVIEW" ? "amber" : "green"}>
          {decision}
        </Badge>
        <Badge tone={hedged ? "violet" : "slate"}>{hedged ? `Hedge ${strategy}` : "No hedge"}</Badge>
        <Badge tone="slate">{dataSource}</Badge>
      </div>

      {/* Hedge choice (requirement 4) — choose WITH or WITHOUT hedge */}
      <div className="rounded-lg border border-hairline bg-surface-2 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Hedge this payment?</p>
        <div className="mt-2 inline-flex rounded-full border border-hairline bg-surface p-0.5">
          <HedgeOption
            active={hedged}
            onClick={() => onHedgeChange("HEDGE")}
            label="Use hedge"
          />
          <HedgeOption
            active={!hedged}
            onClick={() => onHedgeChange("NO_HEDGE")}
            label="No hedge"
          />
        </div>
        <div className="mt-2.5 overflow-hidden rounded-lg border border-hairline bg-surface">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-left text-faint">
              <tr>
                <th className="px-3 py-1.5 font-medium">Instrument</th>
                <th className="px-3 py-1.5 text-right font-medium">Without hedge</th>
                <th className="px-3 py-1.5 text-right font-medium">With hedge</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-1.5 text-muted">{strategy}</td>
                <td className="px-3 py-1.5 text-right text-muted">{withoutExposure} / 100</td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {withExposure} / 100 · +{formatMoney(delta)}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-muted">Total cost</td>
                <td className="px-3 py-1.5 text-right text-muted">{formatMoney(withoutHedge)}</td>
                <td className="px-3 py-1.5 text-right text-muted">{formatMoney(withHedge)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          {hedged
            ? `Hedging removes ${formatMoney(exposureReduction)} of exposure for a +${formatMoney(delta)} premium.`
            : `Skipping the hedge saves the +${formatMoney(delta)} premium but keeps exposure at ${withoutExposure}/100.`}{" "}
          Hedging is a recommendation only — executing a hedge is itself value movement and would require the same human approval gate as the payment.
        </p>
      </div>

      {/* Risk signals */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Risk signals
        </p>
        <div className="space-y-1.5">
          {signals.map((s) => (
            <div key={s.signalId} className="rounded-md border border-hairline px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted">{s.signalId}</span>
                <span className="text-xs text-faint">{s.contribution}/100</span>
              </div>
              <p className="text-xs text-muted">{s.description}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-signal"
                  style={{ width: `${Math.min(100, s.contribution)}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[11px] text-faint">value: {s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HedgeOption({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? "bg-signal text-white" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function ApprovalDetail({
  awaiting,
  approved,
  failed,
  blocked,
  isAcknowledged,
  connected,
  busy,
  error,
  amount,
  destination,
  network,
  routeNo,
  settlement,
  digest,
  cost,
  hedged,
  onAck,
  onApprove,
  onReject,
}: {
  awaiting: boolean;
  approved: boolean;
  failed: boolean;
  blocked: boolean;
  isAcknowledged: boolean;
  connected: boolean;
  busy: "approve" | "reject" | "execute" | null;
  error: string | null;
  amount: string;
  destination: string;
  network: string;
  routeNo: number;
  settlement: "REAL" | "SIMULATED";
  digest: string;
  cost: string;
  hedged: boolean;
  onAck: (v: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (blocked) {
    return (
      <div className="rounded-lg border border-alarm-border bg-alarm-bg p-3 text-xs text-alarm-text">
        This payment was <span className="font-semibold">blocked</span> by a deterministic engine — it can never be
        approved or executed.
      </div>
    );
  }
  if (awaiting) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-ember-border bg-ember-bg p-3 text-xs text-ember-text">
          <span className="font-semibold">Waiting on you.</span> Review the phases above, tick the box, then approve.
          Nothing moves until a human approves.
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={isAcknowledged}
            onChange={(e) => onAck(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-signal"
          />
          <span>
            I understand this executes <span className="font-semibold text-ink">{amount}</span> to{" "}
            <span className="font-mono">{destination}</span> on {network} via route #{routeNo},{" "}
            {hedged ? "with the hedge" : "without the hedge"}, cost {cost}, with a{" "}
            {settlement === "REAL" ? "real on-chain" : "simulated"} settlement. Plan digest{" "}
            <span className="font-mono">{digest.slice(0, 12)}…</span>.
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={!connected || busy !== null}
            onClick={onReject}
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
          <Button
            variant="success"
            disabled={!connected || !isAcknowledged || busy !== null}
            onClick={onApprove}
          >
            {busy === "approve" ? "Approving…" : "Approve and sign"}
          </Button>
        </div>
        {error && <p className="text-xs text-alarm-text">{error}</p>}
        {!connected && <p className="text-xs text-faint">Connect the owning wallet to approve.</p>}
      </div>
    );
  }
  if (approved) {
    return (
      <div className="space-y-2 text-xs">
        <div className="rounded-lg border border-ledger-border bg-ledger-bg p-3 text-ledger-text">
          Approved. A wallet-scoped authz bound to the plan digest was issued. Proceed to{" "}
          <span className="font-semibold">Settle</span> below to authorize execution.
        </div>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="rounded-lg border border-alarm-border bg-alarm-bg p-3 text-xs text-alarm-text">
        This payment was rejected or failed and will never be executed.
      </div>
    );
  }
  return <p className="text-xs text-faint">Approval is pending the pipeline reaching the human gate.</p>;
}

function SettleDetail({
  record,
  approved,
  settled,
  executing,
  failed,
  connected,
  busy,
  onExecute,
}: {
  record: NonNullable<ReturnType<typeof useAppStore>["records"][number]>;
  approved: boolean;
  settled: boolean;
  executing: boolean;
  failed: boolean;
  connected: boolean;
  busy: "approve" | "reject" | "execute" | null;
  onExecute: () => void;
}) {
  if (settled) {
    const s = record.settlement;
    return (
      <div className="space-y-1 text-xs">
        <div className="rounded-lg border border-ledger-border bg-ledger-bg p-3 text-ledger-text">
          {s?.simulated === false && s?.txDigest ? (
            <>
              Settled <span className="font-semibold">on-chain (real testnet)</span> — digest{" "}
              <a
                href={`https://suiscan.xyz/testnet/tx/${s.txDigest}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline decoration-dotted"
              >
                {s.txDigest.slice(0, 18)}…
              </a>
            </>
          ) : (
            <>Settled. No real value moved.</>
          )}
        </div>
        {s?.error && <p className="text-ember-text">{s.error}</p>}
      </div>
    );
  }
  if (executing) {
    return (
      <div className="rounded-lg border border-signal-border bg-signal-bg p-3 text-xs text-signal-text">
        Executing — authorizing wallet signature and settling…
      </div>
    );
  }
  if (failed) {
    const f = record.execution?.failure;
    return (
      <div className="rounded-lg border border-alarm-border bg-alarm-bg p-3 text-xs text-alarm-text">
        {f ? (
          <>
            <span className="font-semibold">{failureLabel(f.code)}</span> — {failureUserMessage(f)}
          </>
        ) : (
          <>Failed or rejected — nothing was executed.</>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-faint">Settlement runs after human approval + wallet authz.</p>
      {approved && (
        <Button variant="success" disabled={!connected || busy !== null} onClick={onExecute}>
          {busy === "execute" ? "Authorizing & settling…" : "Authorize & execute"}
        </Button>
      )}
      {!connected && <p className="text-xs text-faint">Connect the owning wallet to settle.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase summary text helpers
// ---------------------------------------------------------------------------

function complianceSummary(preview: PaymentPreview): string {
  switch (preview.compliance.decision) {
    case "ALLOW":
      return "Passed · all checks clear";
    case "REVIEW":
      return "Flagged for review";
    case "BLOCK":
      return "Blocked";
    default:
      return preview.compliance.decision;
  }
}

function approvalSummary(state: string, blocked: boolean): string {
  if (blocked) return "Blocked";
  switch (state) {
    case "AWAITING_APPROVAL":
      return "Waiting on you";
    case "APPROVED":
      return "Approved · ready to settle";
    case "SETTLED":
      return "Approved";
    case "FAILED":
      return "Rejected";
    default:
      return "Pending";
  }
}

function settleSummary(
  record: NonNullable<ReturnType<typeof useAppStore>["records"][number]>,
  executing: boolean,
  settled: boolean,
  failed: boolean,
): string {
  if (settled) {
    return record.settlement?.simulated === false
      ? "Settled on-chain"
      : record.settlement?.error
        ? "Settled · simulated fallback"
        : "Settled · simulated";
  }
  if (executing) return "Executing…";
  if (failed) return "Not settled";
  return "Pending";
}
