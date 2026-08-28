# MOVA — Development Roadmap

> **Phase 0 deliverable.** The foundation is complete. Feature work starts in
> Phase 1. Each phase has a definition of done; nothing moves to the next phase
> until the gates pass and the docs/foundation stay in sync.

## Phase 0 — Foundation (this phase) ✅

- Architecture, data model, state machine, contracts, env spec, integration
  strategy, conventions, roadmap (this `docs/` set).
- Foundation packages: `types`, `config`, `logger`, `core`, `integrations`.
- Deterministic mocks behind provider interfaces.
- `scripts/phase0-smoke.ts` (28 checks) + `npm run typecheck` green.
- **DoD:** docs coherent, typecheck green, smoke green, no feature code.

## Phase 1a — Wallet, Sui ownership & app shell ✅

Wallet-first milestone (see [`docs/ownership.md`](ownership.md)):

- **`@mova/wallet`** (`packages/wallet`): Sui ownership layer — `WalletExecutionGate`
  (safety boundary), ownership proof (sign-in-with-Sui), `PaymentAuthz` (human-approved,
  wallet-scoped, nonce'd), payment records/receipts, network handling, provider abstraction.
- **`apps/web`**: Next.js + `@mysten/dapp-kit-react` (v2) shell — dashboard, natural-language
  payment input, deterministic validation, payment-flow timeline, approval interface,
  txn history, notification/status area, ownership panel, network detection + switching,
  dev-only Demo Wallet.
- **`contracts/mova`**: `mova_owned.move` ownership blueprint (Sui-owned `MovaPaymentAuthz`,
  `OwnedPaymentRecord`, `MovaReceipt`) — deploy target for Phase 2.
- **Safety boundary enforced:** nothing reaches `EXECUTING` without
  `Intent → Validation → Approval → Wallet authz → Execution`. AI suggestions and
  network mismatches are refused fail-closed.
- **DoD:** wallet connects, network detected, user identity available, ownership visible,
  failed wallet ops handled, no AI instruction bypasses approval. Settlement = simulated
  (no fake digests). Typecheck + wallet tests green.

## Phase 1b — Natural-language payment & intent parsing ✅

Conversational payment interface (see [`docs/nl-payments.md`](nl-payments.md)):

- **`@mova/ai`** (new, implemented): NL → structured intent parser — deterministic
  slot extraction, optional schema-constrained LLM structured output
  (proposal-only), lightweight session conversation context, follow-up merge +
  correction detection, explanation generation.
- **`@mova/core`** (extended): deterministic `IntentValidator` implementing the
  Phase 2 validation matrix (missing/invalid amount, missing/unsupported
  currency, missing/ambiguous recipient, invalid address, unsupported network,
  conflicting instructions, unsupported payment method). Recomputes money —
  the AI never computes `Money`.
- **`apps/web`**: `ChatPaymentInterface` — chat input, structured intent card,
  validation issues, MOVA explanation, **user confirmation gate**, then hands
  the confirmed intent to the existing pipeline (approval → wallet authz →
  simulated settlement).
- **Safety:** the AI is a parser/assistant only — never a transaction executor,
  compliance authority, or final payment authority.
- **DoD:** NL → Structured Intent → Validation → User Confirmation works in the
  UI; typecheck + tests green (`@mova/core` 16, `@mova/ai` 33).

## Phase 1 — Core pipeline (Supabase backend, simulated settlement)

- **Supabase** (`supabase/`): Edge Functions per `api-contracts.md`;
  `PaymentOrchestrator`; migrations with RLS + append-only `audit_events`;
  Realtime status push.
- **DB** (`packages/db`): schema mirroring `packages/types`; role-based RLS.
- **Engines** (`packages/core`): implement `IntentValidator`, `RouteDiscovery`,
  `RouteOptimizer`, `ComplianceEngine` (screening/monitoring/score/policy/travel
  rule — port the patterns from `COMPLIANCE_LAYER.md`), `RiskEngine`,
  `HedgingEngine`, `ApprovalService`, `ExecutionService`, `AuditService`.
- **QR** (`packages/qr`): wire `EmvcoQrDecoder` into `PaymentOrchestrator.createFromQr`
  (decoder already implemented + tested in Phase 0).
- **AI** (`packages/ai`): Gemini `IntentParser` with structured output + retry; a
  physical import boundary so `packages/ai` cannot import execution modules.
- **Web** (`apps/web`): Next.js + Supabase client; intent composer, QR scan,
  timeline, compliance/risk panels, approval UI, audit viewer (thin client).
- Settlement = **simulated** (no fake digests; flagged in audit).
- **DoD:** full happy path runs end-to-end in `dev` with mocks; all state
  transitions covered by tests; typecheck + tests green; UI shows the full flow.

## Phase 2 — Real Sui settlement (testnet → mainnet target)

**In progress — native SUI settlement on testnet is DONE and verified.**

- **`SuiSettlementProvider`** (`packages/integrations/src/sui-settlement.ts`): ✅
  builds a PTB from explicit validated params, dry-runs (simulate), signs with
  the custodial key, submits via gRPC, waits for confirmation. Returns a REAL
  `txDigest`, `simulated: false`.
- **Verified on testnet**: ✅ `scripts/settle-real.ts` settled 0.1 SUI with a
  REAL CONFIRMED digest and the recipient balance increased on-chain.
- **Web execute path**: ✅ attempts a REAL on-chain transfer through the
  connected wallet (`dAppKit.signAndExecuteTransaction`, gated by
  `WalletExecutionGate`) when `NEXT_PUBLIC_SETTLEMENT_MODE=real` (default);
  falls back to SIMULATED with the reason recorded when the wallet can't
  submit (e.g. the in-page Demo Wallet has no testnet gas / no execute
  support). A funded testnet wallet settles for real in the browser.
- **Remaining:**
  - **Move package** (`contracts/`): smart wallet + executor authorization,
    replay protection, safe token handling (patterns from `SMART_WALLET.md`,
    ported to Move; Sui owned objects). The **Sui CLI is now installed**
    (`sui 1.78.1`) and `contracts/mova` compiles + unit-tests cleanly
    (`sui move build`/`test` → exit 0); the smart-wallet execution package
    still needs to be written and published (`sui client publish`), which
    needs a `sui client` account + testnet gas.
  - TOKEN_TRANSFER payloads in `SuiSettlementProvider` (native SUI transfer
    only so far).
  - `mainnet` boundary validation (mocks already refused; real settlement must
    be exercised against a funded mainnet wallet).
- **DoD (partial):** real testnet digests confirmed ✅; audit records real
  `simulated: false` ✅; `mainnet` boundary still refuses mocks ✅; mainnet
  config validated for the production target (pending).

## Phase 3 — Real Thetanuts V4 / Optionbook integration

- **`ThetanutsHedgingProvider`**: live quotes from the V4 Optionbook;
  hedge execution through the same approval gate (hedging is itself value
  movement). Config via `THETANUTS_VERSION=v4` / `THETANUTS_OPTIONBOOK_ADDRESS`.
- **DoD:** hedge quote flows into `RiskAssessment`; executed hedges audited.

## Phase 4 — Route Discovery & Mathematical Route Optimization ✅

Deterministic routing engine (see [`docs/routing.md`](routing.md)):

- **`@mova/types`** (extended): transparent routing model — `RouteLegKind`,
  `RouteCostBreakdown`, `RouteSummary`, `RouteRisk`/`RouteRiskFactor`,
  `RouteFactorScores`, `RoutePreferenceWeights`, `RouteComparisonRow`,
  `RouteSavings`, `RouteOptimizationResult`; `Route` now carries the full
  candidate data + optimizer scores.
- **`@mova/core`** (`src/routing/`): `RouteDiscoveryEngine` (enumerates
  direct / conversion / fiat routes across `SUI_CHAIN`, `MOVA_DEX`,
  `MOVA_ONRAMP`, `MOVA_FIAT_RAIL`, `SUI_SETTLEMENT`, prices them from
  `MarketDataProvider` quotes with integer math, skips unpriceable routes);
  `RouteOptimizerEngine` (min-max factor normalization + weighted composite
  score; COST/SPEED/RELIABILITY profiles or explicit user weights; transparent
  `selectionReason`; comparison rows + savings); `RouteEngine` facade
  (`compute(intent, parsed, criterion, options?)`).
- **Deterministic**: no LLM; scores are pure functions of the candidate set
  and the weights; identical input → identical output.
- **DoD:** `RouteEngine.compute` returns ranked routes + comparison + savings;
  typecheck + 39 core tests green (23 routing).

## Phase 5 — Hardening & production readiness

- Real screening/market-data providers; monitoring & alerting; retention.
- `mainnet` config exercised against a funded wallet (dry-run simulations).
- Load, failure-injection, and audit-integrity tests.
- **DoD:** `mainnet` boots only with real providers; every gate enforced;
  rollback path documented.

## Phase 6 — Risk Assessment & Thetanuts Hedging ✅

Deterministic financial risk + hedge evaluation feeding MOVA's **final payment
recommendation** (see [`docs/risk-hedging.md`](risk-hedging.md)):

- **`@mova/core` (`src/risk/`)**: `RiskEngine` (5 signals — asset volatility,
  FX exposure, route risk, liquidity, settlement risk — score 0–100, band
  LOW/MEDIUM/HIGH/CRITICAL, decision PROCEED/REVIEW/BLOCK); `HedgingEngine`
  (hedge need, instrument, premium, exposure reduction, **route vs route+hedge**
  comparison); `HedgedRouteEngine` facade → `PaymentRecommendation`
  (route + risk + hedge + total cost + explanation). Deterministic VaR math
  (z-score table, integer-safe) in `volatility.ts`.
- **`@mova/types`**: `VolatilitySnapshot`, `HedgeImpact`, `RouteHedgeComparison`,
  `PaymentRecommendation`; `HedgeDecision` / `HedgeDataSource` enums; `RiskSignal`
  gained `note`.
- **`@mova/integrations`**: `ThetanutsHedgingProvider` (REAL — V4 Optionbook
  via the SDK, ETH/BTC, live implied vol + premium; honestly reports
  `ERR_INTEGRATION_UNAVAILABLE` when unreachable/unsupported — never fakes a
  live quote) + `StaticThetanutsHedgingProvider` (dev-only cached table,
  `simulated: true`, `STATIC_DEV`) + `VolatilityProvider`/`StaticVolatilityProvider`.
- **`apps/web`**: `RiskAssessmentPanel` — risk score/band, signal breakdown,
  route-vs-route+hedge table, final recommendation; honest data-source labels;
  wired into the demo pipeline (`riskViews` in the store).
- **Demo**: `npm run risk:demo` (`scripts/risk-hedge-demo.ts`).
- **DoD:** risk + hedge feed the final recommendation; deterministic + tested;
  live-unavailable → honest UNAVAILABLE fallback (never pretend mock is live);
  typecheck + full suite green (core 55, integrations 10, web build clean).

## Phase 7 — Human Approval & Payment Execution ✅

Builds the complete, controlled payment execution pipe (see
[`docs/execution.md`](execution.md)):

- **`@mova/types` (`execution.ts`)**: `TransactionSpec` (the signed-against
  plan — versioned, digest-bound, never built from raw LLM output);
  `PaymentPreview` (recipient, amount, asset, route, fees, savings, compliance,
  risk, hedge, expected settlement, Sui destination, plan digest);
  `ExecutionFailureInfo` (structured taxonomy: user rejection, insufficient
  balance, network failure, invalid recipient, transaction failure, timeout,
  integration unavailable, idempotency violation, approval expiry);
  `PaymentExecutionInfo` (per-record idempotency state).
- **`@mova/core` (`src/execution/`)**: dependency-free SHA-256 (`sha256.ts`);
  `buildTransactionSpec`/`planDigest`/`assertSpecIntegrity`/`assertAuthzMatchesSpec`
  (`plan.ts` — deterministic txn construction from validated state, the digest is
  what the human approves and execution verifies); `classifyExecutionFailure`
  (`failure.ts`); `beginExecution`/`markExecuted`/`markFailed` (`idempotency.ts`);
  `runComplianceGate` (fail-closed screening, `compliance.ts`);
  `buildPaymentPreview` (`preview.ts`); `PaymentExecutionEngine.buildPlan`
  (`engine.ts`) — the full pipe: route discovery → optimization → compliance →
  risk/hedge → spec + preview.
- **`@mova/logger`**: new error codes `ERR_INSUFFICIENT_BALANCE`,
  `ERR_BALANCE_QUERY_FAILED`, `ERR_NETWORK_FAILURE`, `ERR_EXECUTION_TIMEOUT`,
  `ERR_IDEMPOTENCY_VIOLATION`.
- **`@mova/wallet`**: `PaymentAuthz.specDigest` (the authz is bound to exactly
  the plan digest the human approved); `PaymentRecord.execution` (idempotency
  state).
- **`apps/web`**: `lib/pipeline/execution-engine.ts` (browser bridge for the
  full pipe); `lib/pipeline/balance.ts` (best-effort pre-flight balance check);
  `PaymentPreviewPanel` (the human approval UX — "I understand what this
  executes" acknowledgment gating Approve; blocked/REVIEW states); `ApprovalPanel`
  (Authorize & execute → real-or-simulated Sui settlement); store wiring
  (plans per record, spec-bound approval, idempotent execution, structured
  failure surfacing).
- **Deliverable:** complete end-to-end payment flow — Intent → Parsing →
  Validation → Route → Compliance → Risk/Hedge → Explanation (Preview) →
  Human Approval → Wallet authz → Execution → Sui Settlement. Real settlement
  preferred (same verified `settle-real.ts`/`SuiSettlementProvider` path from
  Phase 2), simulated fallback honest (`txDigest: null`, reason recorded).
- **DoD:** full typecheck green; core 96 / ai 34 / qr 10 / wallet 18 /
  integrations 10 tests green; web build clean; browser flow verified
  (preview → acknowledge → approve → execute → SETTLED, and insufficient-
  balance failure surfaced across all panels).

## Ongoing (every phase)

- Keep `docs/` and foundation packages in sync with any design change.
- Run `npm run typecheck` and the full test suite before merging; review
  value/compliance changes; describe rollback.
- Never bypass the AI-deterministic boundary to "save time".
