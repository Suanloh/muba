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

## Phase 4 — Hardening & production readiness

- Real screening/market-data providers; monitoring & alerting; retention.
- `mainnet` config exercised against a funded wallet (dry-run simulations).
- Load, failure-injection, and audit-integrity tests.
- **DoD:** `mainnet` boots only with real providers; every gate enforced;
  rollback path documented.

## Ongoing (every phase)

- Keep `docs/` and foundation packages in sync with any design change.
- Run `npm run typecheck` and the full test suite before merging; review
  value/compliance changes; describe rollback.
- Never bypass the AI-deterministic boundary to "save time".
