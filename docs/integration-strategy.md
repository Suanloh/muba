# MOVA — Integration Strategy

> **Phase 0 deliverable.** MOVA depends on external sponsors: settlement (Sui),
> hedging (Thetanuts), market data, and screening. Each sits behind a provider
> interface in `packages/integrations` with a **deterministic mock** for Phase 0.
> This document defines how the mocks behave and how real integrations replace
> them without touching the core.

## Sponsor boundaries

| Boundary | Interface | Mock (Phase 0) | Real integration (later) |
| --- | --- | --- | --- |
| Settlement | `SettlementProvider` | `SimulatedSettlementProvider` | **Sui (Mainnet target)** via `@mysten/sui` + Move smart wallet |
| Hedging | `HedgingProvider` | `MockHedgingProvider` | **Thetanuts V4 / Optionbook** |
| Market data | `MarketDataProvider` | `MockMarketDataProvider` | Price feed / oracle |
| Screening | `ScreeningProvider` | `MockScreeningProvider` | Sanctions/watchlist vendor |

> **QR is NOT a sponsor.** It is a local deterministic EMVCo decoder
> (`packages/qr`) with no external call — see below.

Every provider exposes `descriptor: { kind: "MOCK" | "REAL", name, network }`.
The audit trail records which implementation produced each result.

## Mock contract (deterministic, honest)

Mocks are **deterministic** (same input → same output) and **honest** (flagged
`simulated: true`):

- **`SimulatedSettlementProvider`** — returns `{ ok: true, simulated: true,
  txDigest: null, status: "SIMULATED" }`. It **never fabricates a digest** and
  never claims a real transaction. It refuses to run when mocks are not
  permitted (`MOCK_FORBIDDEN`).
- **`MockHedgingProvider`** — deterministic quote (e.g. premium = fixed bps of
  notional). It represents a *quote*, never an executable Thetanuts position.
- **`MockMarketDataProvider`** — fixed, versioned simulated price table.
- **`MockScreeningProvider`** — exact (case-insensitive) match against a small
  simulated watchlist; ambiguous/empty identity → `REVIEW` (never `CLEAR`).

## Mock policy per boundary

| Boundary | `dev` | `testnet` | `mainnet` |
| --- | --- | --- | --- |
| Mocks | allowed | allowed | **refused** (boot fails closed) |
| Settlement | simulated (default) | simulated or real | **real only** |

Defense in depth: even if a mock is somehow constructed, `allowed: false`
makes it throw `ERR_MOCK_FORBIDDEN` on first use.

## Migration path: mock → real

1. **Define the interface** (done in Phase 0).
2. **Implement the real provider** in `packages/integrations` (e.g.
   `src/settlement/sui.ts`, `src/hedging/thetanuts.ts`) behind the same
   interface, `descriptor.kind = "REAL"`.
3. **Wire by config**, not code: a factory/DI switch on
   `SETTLEMENT_MODE`, `MARKET_DATA_PROVIDER`, and `USE_MOCKS` selects the
   implementation. No core engine changes.
4. **Same audit contract** — real providers also emit results through
   `AuditService`; `simulated` is simply `false`.
5. **Run in `testnet` first**, then flip `mainnet`.

## QR — local EMVCo decoder (not a sponsor)

QR payment initiation is decoded **locally and deterministically** in
`packages/qr` (`EmvcoQrDecoder` → `QrDecoded`):

- Parses EMVCo TLV fields (merchant account, name, amount, currency, CRC).
- Validates CRC-16/CCITT; a bad CRC is rejected (fail-closed).
- No external QR API, no LLM, no network — the decoded amount/account are
  trusted inputs into the intent pipeline.
- `QR_STRICT_CRC` controls whether tampered payloads are hard-rejected.

The decoder runs wherever the scan happens (device or Edge Function) and feeds
`PaymentOrchestrator.createFromQr`.

## Sui settlement (Phase 2)

- **Production target is Sui MAINNET.** Dev/test use Sui devnet/testnet.
- Move package in `contracts/` (mirrors the legacy wallet's security patterns:
  executor authorization, replay protection, safe token handling — see
  `SMART_WALLET.md` for the EVM reference of those patterns).
- `SuiSettlementProvider` submits a programmable transaction block built from
  the **explicit, validated** `SettlementTransaction.payload` produced by
  `ExecutionService` — never from LLM output.
- Confirmation watcher advances `EXECUTING → SETTLED` only on a real digest /
  confirmed effects. Reverts/timeouts → `EXECUTION_FAILED`.

## Thetanuts hedging (Phase 3)

- `ThetanutsHedgingProvider` targets **Thetanuts V4 / Optionbook** (on-chain
  options & structured products) for quotes and, after the approval gate,
  execution. Config via `THETANUTS_VERSION=v4`,
  `THETANUTS_OPTIONBOOK_ADDRESS`, `THETANUTS_NETWORK`.
- Hedging is a **recommendation** feeding `RiskAssessment.hedging`; executing a
  hedge is itself a value-moving action that requires the same human approval
  gate as any payment.

## Failure handling (fail-closed)

- **Settlement unavailable** → execution aborts; payment stays `EXECUTING` or
  moves to `FAILED` with `ERR_SETTLEMENT_FAILED`; never auto-retry a revert.
- **Screening unavailable** → `ComplianceEngine` fail-closes to
  `REVIEW`/`BLOCK` (`ERR_COMPLIANCE_UNAVAILABLE`).
- **Market data unavailable** → routing aborts (`ERR_ROUTING_FAILED`), never
  guesses a price.
- **Hedging unavailable** → risk proceeds with `hedging.recommended = false`
  and records the gap (hedging is optional; settlement is not).

## What this buys

- Phase 0/1 runs end-to-end with honest, deterministic sponsors — the pipeline,
  state machine, compliance, risk, approval, and audit are all exercised
  without real money or real chains.
- Swapping in Sui + Thetanuts later is a **provider swap**, not a refactor.
