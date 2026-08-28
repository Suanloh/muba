"use client";
/**
 * MOVA Phase 8 — Payment Explanation.
 *
 * Answers the 6 trust questions for the active payment, derived from the
 * deterministic plan (preview / recommendation / optimization) — never from
 * raw LLM output:
 *
 *   1. What did MOVA understand?
 *   2. Why did it select this route?
 *   3. Which compliance checks passed?
 *   4. Why was hedging used?
 *   5. What did the user approve?
 *   6. What happened on-chain?
 */
import { buildPaymentExplanation } from "@/lib/pipeline/trace";
import { useAppStore } from "@/lib/store/app-store";
import { formatDateTime, formatDuration, formatMoney, shortId } from "@/lib/pipeline/format";
import { Badge, Card } from "./ui";
import type { ReactNode } from "react";

export function PaymentExplanationPanel() {
  const { records, plans, activeRecordId } = useAppStore();
  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;

  if (!record) {
    return (
      <Card title="Payment explanation" subtitle="Understand every step — intent to settlement.">
        <p className="text-sm text-slate-500">No payment yet.</p>
      </Card>
    );
  }

  const plan = plans[record.id] ?? null;
  const ex = buildPaymentExplanation(record, plan);
  const tone =
    ex.status === "SETTLED" ? "green" : ex.status === "FAILED" ? "red" : ex.status === "AWAITING_APPROVAL" ? "amber" : "slate";

  return (
    <Card
      title="Payment explanation"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · <Badge tone={tone}>{ex.status}</Badge>
        </>
      }
    >
      <div className="space-y-3">
        {/* 1 — What MOVA understood */}
        <Section n={1} question="What did MOVA understand?">
          <p className="text-xs text-slate-600">
            <span className="italic text-slate-500">"{ex.understood.rawText}"</span>
          </p>
          <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
            <KV k="Action" v={ex.understood.action} />
            <KV k="Amount" v={formatMoney(ex.understood.amount)} />
            <KV k="Recipient" v={`${ex.understood.recipient.value}${ex.understood.recipient.name ? ` (${ex.understood.recipient.name})` : ""}`} />
            <KV k="Network" v={ex.understood.network} />
            <KV k="Memo" v={ex.understood.memo ?? "—"} />
          </dl>
        </Section>

        {/* 2 — Why this route */}
        <Section n={2} question="Why did MOVA select this route?">
          <p className="text-xs text-slate-600">{ex.route.selectionReason}</p>
          <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
            <KV k="Route" v={ex.route.routeNo > 0 ? `#${ex.route.routeNo} ${ex.route.legOrder.join("→")}` : "—"} />
            <KV k="Candidates considered" v={String(ex.route.candidateCount)} />
            <KV k="Fees" v={formatMoney(ex.route.fees)} />
            <KV k="Est. cost" v={formatMoney(ex.route.totalEstimatedCost)} />
            <KV k="Est. time" v={formatDuration(ex.route.estimatedTimeMs)} />
            <KV k="Reliability" v={ex.route.reliability > 0 ? `${Math.round(ex.route.reliability * 100)}%` : "—"} />
          </dl>
          {ex.route.savings && (
            <p className="mt-1 text-[11px] text-slate-500">{ex.route.savings.explanation}</p>
          )}
        </Section>

        {/* 3 — Compliance checks passed */}
        <Section n={3} question="Which compliance checks passed?">
          <p className="text-xs text-slate-600">{ex.compliance.explanation}</p>
          <ul className="mt-1 space-y-0.5">
            {ex.compliance.checks.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                <span className="mt-0.5 text-emerald-500">✓</span>
                {c}
              </li>
            ))}
          </ul>
          {ex.compliance.matchedLists.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-700">Matched lists: {ex.compliance.matchedLists.join(", ")}</p>
          )}
        </Section>

        {/* 4 — Why hedging */}
        <Section n={4} question="Why was hedging used?">
          <p className="text-xs text-slate-600">
            Risk: <Badge tone={ex.risk.band === "HIGH" || ex.risk.band === "CRITICAL" ? "red" : ex.risk.band === "MEDIUM" ? "amber" : "green"}>{ex.risk.band}</Badge>{" "}
            <span className="text-slate-500">· {ex.risk.score}/100 · {ex.risk.decision}</span>
          </p>
          {ex.risk.topSignals.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {ex.risk.topSignals.map((s, i) => (
                <li key={i}>
                  <span className="text-slate-500">{s.description}:</span> {s.value} (threshold {s.threshold})
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-xs text-slate-600">{ex.hedge.explanation}</p>
          <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
            <KV k="Decision" v={ex.hedge.decision} />
            <KV k="Strategy" v={ex.hedge.strategy} />
            <KV k="Premium" v={formatMoney(ex.hedge.premium)} />
            <KV k="Exposure reduced" v={formatMoney(ex.hedge.exposureReduction)} />
            <KV k="Data source" v={ex.hedge.dataSource} />
          </dl>
        </Section>

        {/* 5 — What the user approved */}
        <Section n={5} question="What did you approve?">
          <p className="text-xs text-slate-600">
            Decision: <span className="font-medium">{ex.approval.decision ?? "pending"}</span> · status {ex.approval.status}
            {ex.approval.approvedAt ? ` · ${formatDateTime(ex.approval.approvedAt)}` : ""}
          </p>
          <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
            <KV k="Plan digest" v={ex.approval.planDigest ? `${ex.approval.planDigest.slice(0, 20)}…` : "—"} />
            <KV k="Authz nonce" v={ex.approval.authzNonce ? ex.approval.authzNonce.slice(0, 14) : "—"} />
            <KV k="Expires" v={ex.approval.expiresAt ? formatDateTime(ex.approval.expiresAt) : "—"} />
          </dl>
          <p className="mt-1 text-[11px] text-slate-500">
            The digest is a SHA-256 over the exact transaction spec — execution verifies it before anything moves.
          </p>
        </Section>

        {/* 6 — What happened on-chain */}
        <Section n={6} question="What happened on-chain?">
          <dl className="grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
            <KV k="Expected settlement" v={ex.onChain.expectedSettlement} />
            <KV k="Status" v={ex.onChain.status ?? "not started"} />
            <KV
              k="Digest"
              v={
                ex.onChain.txDigest ? (
                  <a
                    href={`https://suiscan.xyz/testnet/tx/${ex.onChain.txDigest}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sky-600 underline decoration-dotted"
                  >
                    {ex.onChain.txDigest.slice(0, 22)}…
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <KV k="Simulated" v={ex.onChain.simulated === null ? "—" : String(ex.onChain.simulated)} />
            <KV k="Signed by" v={ex.onChain.signedBy ? `${ex.onChain.signedBy.slice(0, 12)}…` : "—"} />
            <KV k="Signed at" v={ex.onChain.signedAt ? formatDateTime(ex.onChain.signedAt) : "—"} />
          </dl>
          {ex.onChain.error && <p className="mt-1 text-[11px] text-amber-700">{ex.onChain.error}</p>}
          {ex.onChain.simulated && (
            <p className="mt-1 text-[11px] text-slate-500">Simulated — no real value moved and no digest was fabricated.</p>
          )}
        </Section>
      </div>
    </Card>
  );
}

function Section({
  n,
  question,
  children,
}: {
  n: number;
  question: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <p className="mb-1.5 text-xs font-semibold text-slate-700">
        <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">
          {n}
        </span>
        {question}
      </p>
      <div>{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 sm:block">
      <span className="text-slate-500">{k}: </span>
      <span className="text-slate-700">{v}</span>
    </div>
  );
}
