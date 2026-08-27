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

- **Move package** (`contracts/`): smart wallet + executor authorization,
  replay protection, safe token handling (patterns from `SMART_WALLET.md`,
  ported to Move; Sui owned objects).
- **`SuiSettlementProvider`**: programmable transaction blocks from explicit,
  validated params; confirmation watcher (`EXECUTING → SETTLED`).
- Deploy to devnet, then testnet; `SETTLEMENT_MODE=real` in testnet.
- **DoD:** real testnet digests confirmed; audit records real `simulated: false`;
  `mainnet` boundary still refuses mocks; mainnet config validated for the
  production target.

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
