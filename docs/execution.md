# MOVA Phase 7 — Human Approval & Payment Execution

> **Core principle: AI recommends → Deterministic engines validate → Human
> approves → Wallet executes.**

This document describes the complete payment execution pipe that connects all
prior MOVA phases into one controlled flow:

```
Input → Intent Parsing → Intent Validation → Route Discovery → Route Optimization
→ Compliance → Risk/Hedge → Payment Explanation → Payment Preview (Human Approval)
→ Wallet authz → Execution → Sui Settlement
```

Nothing in the pipe is produced by an LLM. The AI (`@mova/ai`) is proposal-only;
every figure is recomputed by deterministic engines; the human approves a stable
**plan digest**; execution is built from that exact approved spec and verified
before anything moves.

---

## 1. Payment Preview (what the human must understand)

Before any execution, `PaymentExecutionEngine.buildPlan` produces a
`PaymentPreview` from validated state. It shows every field the human must
understand:

| Field | Source |
| --- | --- |
| Recipient | validated intent (`PaymentRecord.recipient`) |
| Amount / Asset | canonical amount in smallest units |
| Route | selected `Route` (routeNo, legs, fees, reliability, selectionReason) |
| Fees | `route.totalFee` (quote asset) |
| Savings | `RouteSavings` (cheapest vs selected vs worst) |
| Compliance status | `runComplianceGate` (ALLOW / REVIEW / BLOCK, fail-closed) |
| Risk | `RiskAssessment` (band, score, signals, decision) |
| Hedge (if relevant) | `RouteHedgeComparison` (strategy, premium, exposure reduction) |
| Expected settlement | `REAL` or `SIMULATED` (honest, never faked) |
| Sui destination | canonical lowercase `0x…` address |
| Plan digest | SHA-256 over the canonical spec — what the human signs off on |

The web `PaymentPreviewPanel` renders this and gates **Approve** behind an
"I understand what this executes" acknowledgment checkbox. A BLOCK verdict
(compliance or risk) disables approval entirely.

## 2. Deterministic transaction construction

The `TransactionSpec` is built **only** from validated state
(`packages/core/src/execution/plan.ts`):

- `buildTransactionSpec` re-validates the recipient (Sui address), sender,
  positive amount, and route — fail-closed, never a partial plan.
- `planDigest = SHA-256(canonicalSpec(spec))` over a fixed, ordered field set.
- The human approves the digest; `issuePaymentAuthz` records
  `PaymentAuthz.specDigest`.
- At execution, `assertSpecIntegrity` re-hashes the spec and
  `assertAuthzMatchesSpec` verifies the authz was issued for **this exact**
  digest. A mutated spec → `EXECUTION_GATE_BLOCKED`.

Raw LLM output never contributes to the transaction. The web PTB builder
(`buildTransferTransaction`) is fed from `spec.amount` / `spec.recipient` /
`spec.sender`, not from mutable record or chat state.

## 3. Human approval

- Approval is explicit and digest-bound (`approveFlow` → `PaymentAuthz` with
  `specDigest`).
- The user must understand what they approve: the preview + acknowledgment
  checkbox, and the authz message shown at execution includes the plan digest.
- Rejection (`rejectFlow`) records `USER_REJECTED`; nothing executes.

## 4. Wallet authz & execution

`executeFlow` (`apps/web/lib/pipeline/demo-pipeline.ts`) runs the gated tail:

1. **Spec integrity** — digest must still match.
2. **Idempotency** — `beginExecution` refuses duplicate / expired / replayed
   executions (same `clientRequestId` with a different digest).
3. **Wallet gate** — `WalletExecutionGate` (defense in depth) must pass.
4. **Authz digest match** — the authz binds to the spec.
5. **Balance pre-flight** — best-effort `querySuiBalance`; insufficient →
   `INSUFFICIENT_BALANCE` **before** the wallet signs.
6. **Wallet authz signature** — the owner signs an explicit message over the
   spec (record, owner, amount, recipient, network, route, total, plan digest,
   authz nonce).
7. **EXECUTION_STARTED** → real-or-simulated Sui settlement → **SETTLED** +
   receipt.

## 5. Sui settlement

- **Real preferred**: the PTB is built from the approved spec and submitted
  through the connected wallet (`signAndExecuteTransaction`); a real testnet
  digest is recorded (`simulated: false`). This is the same verified
  `SuiSettlementProvider` path from Phase 2 (`scripts/settle-real.ts` settled a
  real on-chain transfer; requires a funded testnet wallet).
- **Simulated fallback (honest)**: when the wallet can't fund/submit, the flow
  records `simulated: true`, `txDigest: null`, and the reason in
  `settlement.error`. A digest is never fabricated.
- `NEXT_PUBLIC_SETTLEMENT_MODE=simulated` forces the deterministic demo path.

## 6. Failure handling

Every failure is classified into an `ExecutionFailureInfo` (see
`packages/core/src/execution/failure.ts`) and surfaced across the UI:

| Scenario | Failure code | Notes |
| --- | --- | --- |
| User rejects | `USER_REJECTED` | actionable, retryable |
| Insufficient balance | `INSUFFICIENT_BALANCE` | pre-flight before signing |
| Network / RPC down / chain mismatch | `NETWORK_FAILURE` | actionable |
| Invalid recipient | `INVALID_RECIPIENT` | caught at validation |
| On-chain submission failed | `TRANSACTION_FAILED` | non-retryable (may carry digest) |
| No confirmation in time | `TIMEOUT` | retryable |
| External engine unavailable | `INTEGRATION_UNAVAILABLE` | fail-closed |
| Duplicate / replay / mutated spec | `IDEMPOTENCY_VIOLATION` | never retryable |
| Approval window passed | `APPROVAL_EXPIRED` | actionable |

The record moves to `FAILED` through the state machine; the structured failure
is recorded on `PaymentRecord.execution.failure` and shown in the preview,
approval panel, and transaction history.

## 7. Idempotency

Duplicate execution is prevented at three layers:

1. **State machine** — `SETTLED` / `FAILED` are terminal (no transitions).
2. **`beginExecution`** — refuses when `executedAt` is set, when the spec is
   expired, or when the same `clientRequestId` appears with a different digest
   (replay/mutation).
3. **UI in-flight guard** — the store refuses concurrent/re-entrant execution
   of the same record.

## 8. Tests

- `packages/core/src/execution/plan.test.ts` — spec determinism, digest
  stability, integrity, invalid inputs, SHA-256 FIPS vectors.
- `packages/core/src/execution/idempotency.test.ts` — duplicate, digest
  mismatch, expiry, attempt counting.
- `packages/core/src/execution/failure.test.ts` — classification mapping.
- `packages/core/src/execution/engine.test.ts` — full pipe end-to-end, blocked
  compliance fail-closed, unavailable engine.

Full suite: core 96 / ai 34 / qr 10 / wallet 18 / integrations 10 (168 tests),
full typecheck green, web build clean.
