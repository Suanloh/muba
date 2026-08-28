# MOVA Phase 8 — txn Status, Audit Trail & Trust Layer

> **Core principle: every payment is traceable from user intent to final
> settlement, and the trace is a PROJECTION of immutable, append-only
> `AuditEvent`s — never produced by the LLM and never fabricated.**

This phase builds the observability + trust surface on top of the Phase 7
execution pipe. It answers the six questions a user (or auditor) must be able
to answer about any payment:

1. **What did MOVA understand?**
2. **Why did it select this route?**
3. **Which compliance checks passed?**
4. **Why was hedging used?**
5. **What did the user approve?**
6. **What happened on-chain?**

---

## 1. txn Status — the complete lifecycle

The state machine already owns the lifecycle
(`CREATED → PARSED → ROUTE_FOUND → COMPLIANCE_CHECKED → RISK_ASSESSED →
AWAITING_APPROVAL → APPROVED → EXECUTING → SETTLED | FAILED` — see
[`state-machine.md`](state-machine.md)). Phase 8 adds the **timestamped
projection** of that lifecycle:

- `buildStatusTimeline(events, correlationId)` (`packages/core/src/trace.ts`)
  turns the transition `AuditEvent`s into an ordered list of
  `PaymentStatusStep` — every state the payment reached, with WHO/WHEN/WHY
  (actor, epoch-ms timestamp, event name, and a one-line detail such as a
  failure code).
- Decision-only events (e.g. `HEDGE_DECIDED`) carry `newState: null` so they
  **never** create a fake lifecycle step — the status shows only real state
  transitions.
- The web `TransactionStatusCard` renders the current state, the selected
  route + cost (fees, est. cost, est. time, reliability, selection reason),
  and the timestamped vertical timeline.

## 2. txn History

`TransactionHistory` lists every payment owned by the address with:

| Column | Source |
| --- | --- |
| Payment id + status | `PaymentRecord` |
| Amount → Recipient | validated `PaymentRecord` |
| **Date/time** | `createdAt` (Phase 8) |
| **Route** | `plan.preview.route` (routeNo, leg order, fees) |
| txn hash | `PaymentSettlement.txDigest` (real) or "no digest (simulated)" |

## 3. Audit Trail — recorded decisions

The append-only `AuditEvent` stream already recorded every state transition.
Phase 8 enriches each decision with its **deterministic payload** and projects
it into a typed, human-readable decision log:

| Stage | Event | Payload recorded |
| --- | --- | --- |
| Original intent | `INTENT_CREATED` | raw text, validation flag |
| Parsed intent | `INTENT_PARSED` | action, amount, recipient, network, memo |
| Route selection | `ROUTE_FOUND` | route id/no, leg order, fees, est. cost, time, reliability, selection reason, **all candidates**, criterion, savings |
| Cost calculation | (in `ROUTE_FOUND`) | per-candidate `totalFee` / `totalEstimatedCost` / `selectionScore` |
| Compliance | `COMPLIANCE_CHECKED` | decision, riskScore, failClosed, matchedLists, checks run |
| Risk | `RISK_ASSESSED` | band, score, decision, signals |
| Hedge | `HEDGE_DECIDED` | decision (HEDGE/NO_HEDGE), strategy, premium, exposure reduction, data source |
| Approval | `APPROVAL_REQUESTED` / `APPROVED` / `APPROVAL_REJECTED` | reason, level, plan digest, authz nonce, expiry |
| Execution | `EXECUTION_STARTED` / `SETTLED` / `EXECUTION_FAILED` | wallet signature, plan digest, tx digest, simulated flag, failure |

`buildAuditTrail` (`packages/core/src/trace.ts`) maps every event to a typed
`PaymentAuditEntry` (stage, label, outcome, detail, immutable `data` payload)
in chronological order. The `AuditTrailPanel` groups them by stage with
expandable raw payloads — full transparency, nothing hidden.

**Trust rule:** if an engine did not emit an event, the trail does not claim
it. `currentState` and `terminal` are derived from the last real transition —
nothing is invented past the last recorded event.

## 4. Payment Explanation — the six questions

`buildPaymentExplanation(record, plan)` (`apps/web/lib/pipeline/trace.ts`)
derives a single `PaymentExplanation` from the deterministic `PaymentPlan`
(preview / recommendation / optimization) — **never** from raw LLM output:

- **Understood** — raw text, action, canonical amount, recipient, network, memo.
- **Route** — selected route, selection reason (the exact scoring math), candidate count, fees, est. cost/time, reliability, savings.
- **Compliance checks passed** — counterparty screening result, risk score, fail-closed status, verdict (a checklist).
- **Hedging** — risk band/score/decision, top risk signals, hedge decision, strategy, premium, exposure reduction, data source (honest: `STATIC_DEV`/`LIVE`).
- **Approved** — approval decision/status/time, the exact plan digest, authz nonce, expiry. The digest is the SHA-256 over the spec the user signed.
- **On-chain** — expected settlement, actual status, digest (or honest "no digest (simulated)"), simulated flag, signer, timestamp.

The `PaymentExplanationPanel` renders these as six numbered sections.

## 5. Notifications

Lightweight, per-payment notifications for the moments that matter:

| Notification | When |
| --- | --- |
| **Approval required** | flow reaches `AWAITING_APPROVAL` |
| **Review required** / **Hedge recommended** | advisory REVIEW verdict / hedge proposal |
| **Approved** | human APPROVE (authz bound to plan digest) |
| **Payment executing** | wallet authz + settlement started (Phase 8) |
| **Payment completed** | settled (real testnet / simulated / simulated fallback) |
| **Payment failed** | structured failure with the honest reason |

Notifications are toasts **and** persisted in a per-record feed
(`notificationFeed` with `recordId`), so the `NotificationsPanel` shows the
full event history per payment even after the toast is dismissed.

## 6. Deliverables

| Deliverable | Location |
| --- | --- |
| Trace/audit/explanation types | `packages/types/src/trace.ts` |
| Deterministic trace projection | `packages/core/src/trace.ts` + `trace.test.ts` |
| Browser explanation + enriched payloads | `apps/web/lib/pipeline/trace.ts` |
| Enriched audit events | `apps/web/lib/pipeline/demo-pipeline.ts` (`runToAwaitingApproval` takes the plan) |
| txn Status card | `apps/web/components/TransactionStatusCard.tsx` |
| txn History (date/route) | `apps/web/components/TransactionHistory.tsx` |
| Audit trail panel | `apps/web/components/AuditTrailPanel.tsx` |
| Payment explanation panel | `apps/web/components/PaymentExplanationPanel.tsx` |
| Notifications panel | `apps/web/components/NotificationsPanel.tsx` |

## 7. Trust guarantees

1. **Projection, not invention.** The trail/status/explanation are derived
   from `AuditEvent`s and the deterministic plan. An unemitted decision is
   absent — a `HEDGE_DECIDED` never creates a status step.
2. **Deterministic & testable.** `trace.ts` is pure data-in → data-out; the
   suite (`trace.test.ts`) asserts ordering, stage mapping, verdict
   derivation, failure details, and honest non-terminal trails.
3. **Honest simulation.** Simulated settlement is flagged `simulated` end-to-
   end (lifecycle step, audit entry, explanation, notification) and a digest
   is never fabricated.
4. **Full disclosure.** Every audit row's raw deterministic payload is
   expandable in the UI — the user/auditor can verify the exact numbers MOVA
   used (route scores, compliance score, hedge premium, plan digest).
