# MOVA — AI-native Autonomous Payment Agent

> **Phase 1 (wallet, ownership & app shell) delivered.** A working MOVA shell now
> connects real Sui wallets, establishes the Sui ownership layer
> (`@mova/wallet` + `docs/ownership.md`), and enforces the safety boundary
> (Intent → Validation → Approval → Wallet authz → Execution). Payment
> *execution* is kept for later phases — settlement is simulated and never
> fabricates a digest.

MOVA turns a human payment intent (typed or scanned from a local EMVCo QR) into
an audited, approved, executed settlement on **Sui (Mainnet target)**, with
hedging via **Thetanuts V4 / Optionbook**.

```
User Intent → AI Parsing → Route Discovery → Route Optimization → Compliance
→ Risk/Hedging → Human Approval → Execution → Sui Settlement → Status/Audit
```

## Stack

| Concern | Choice |
| --- | --- |
| Frontend | **Next.js** (`apps/web`) + `@mysten/dapp-kit-react` (v2) wallet layer |
| Backend / DB | **Supabase** (PostgreSQL, Auth, Realtime, Edge Functions) — Phase 1+ |
| LLM | **Google Gemini** (proposals only) |
| Settlement | **Sui — Mainnet target** (dev/test use devnet/testnet) |
| Ownership | **Sui-owned state** anchored to the user's address (`@mova/wallet`, `contracts/mova`) |
| Hedging | **Thetanuts V4 / Optionbook** |
| QR | **Local EMVCo decoder** (`packages/qr`, no external call) |
| Architecture | AI parses/recommends → deterministic engines validate → human approves → wallet executes |

## Non-negotiable safety property

**The AI is never the final authority over money movement or compliance.**
AI parses, recommends, explains, and assists. Deterministic engines validate,
score, and enforce policy. A human approves irreversible value movement. The
deterministic systems and explicit human approval control execution. See
[`docs/architecture.md`](docs/architecture.md) — this is a compliance incident if
violated, not a style issue.

## Repository layout

```
docs/                 Phase 0 blueprint + ownership model (start here)
packages/types        shared domain models + payment state machine
packages/config       env schema + dev/testnet/mainnet network configs
packages/logger       structured logging + error conventions
packages/core         deterministic engine contracts + state-machine runner + NL validator
packages/qr           local EMVCo QR decoder (deterministic, no external call)
packages/integrations sponsor provider interfaces + deterministic mocks
packages/wallet       Sui ownership layer: gate, authz, network, provider abstraction
packages/ai           NL payment parser (Phase 2) — proposal-only, no execution
apps/web              Next.js wallet-connected app shell + natural-language payment chat
supabase/             backend platform: Edge Functions, Auth, Realtime, Postgres
contracts/            Sui Move package — ownership blueprint (mova_owned.move), deploy in Phase 2
skills/               reusable skill pack (safety + architecture guidance)
```

## Read this first

| Document | What it answers |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Arch overview, layers, module responsibilities, repo structure |
| [`docs/data-model.md`](docs/data-model.md) | Entities & relationships (users, wallets, intents, routes, compliance, risk, approvals, txns, audit) |
| [`docs/state-machine.md`](docs/state-machine.md) | `CREATED → … → SETTLED/FAILED` payment lifecycle |
| [`docs/ownership.md`](docs/ownership.md) | **Sui ownership model** — user ownership, authz, records, receipts as Sui-owned state |
| [`docs/nl-payments.md`](docs/nl-payments.md) | **Natural-language payments (Phase 2)** — NL → structured intent → validation → user confirmation |
| [`docs/risk-hedging.md`](docs/risk-hedging.md) | **Risk assessment & Thetanuts hedging (Phase 6)** — deterministic risk + hedge → final payment recommendation |
| [`docs/api-contracts.md`](docs/api-contracts.md) | Internal module interfaces + HTTP API + event contracts |
| [`docs/environment.md`](docs/environment.md) | Environment-variable spec + dev/testnet/mainnet matrix |
| [`docs/integration-strategy.md`](docs/integration-strategy.md) | Sui / Thetanuts / market-data / screening: mock → real strategy |
| [`docs/conventions.md`](docs/conventions.md) | Logging & error-handling conventions |
| [`docs/roadmap.md`](docs/roadmap.md) | Phased delivery plan (Phase 1 → n) |

## Legacy reference (do not use for MOVA execution)

- `SMART_WALLET.md` — **EVM** (Solidity/Hardhat) smart-wallet spec from a prior
  "PayMaster" project. MOVA adopts its *security patterns* (authz, replay
  protection, nonce, reentrancy guard, safe ERC-20 handling) but settles on
  **Sui (Move)**, not EVM.
- `COMPLIANCE_LAYER.md` — prior PayMaster compliance prototype. MOVA reuses its
  *design* (deterministic counterparty screening, monitoring, unified risk
  score, policy engine, travel rule, audit trail) — the engines are ported as
  deterministic modules, not as an EVM-linked stack.
- `SKILL_PACK.md` + `skills/` — generic reusable skill pack. The
  `ai-deterministic-boundary`, `policy-engine`, `compliance-gate`,
  `audit-trail`, and `fintech-system-architecture` skills are the governing
  design rules for MOVA.

## Quick start

```bash
npm install            # installs workspace deps
npm run typecheck      # type-checks all packages (incl. web)
npm run test -w @mova/wallet   # wallet safety-boundary + ownership tests
cd apps/web && cp .env.local.example .env.local  # web env (defaults: testnet)
npm run dev -w @mova/web      # wallet-connected app shell
```

> The web app includes a dev-only **Demo Wallet** (no browser extension needed) so
> the connect → sign → ownership → approval → simulated-execution flow can be
> exercised end-to-end. Disable with `NEXT_PUBLIC_ENABLE_DEMO_WALLET=false`.

## Status

- **Phase 0 — foundation**: complete (docs, types, core, config, logger, integrations, QR).
- **Phase 1 (wallet, ownership & app shell)**: complete — `@mova/wallet`, `docs/ownership.md`,
  `contracts/mova` ownership blueprint, and the `apps/web` wallet-connected shell. Payment
  *execution* stays for later phases (settlement is simulated, `txDigest = null`).
- **Phase 1b / Phase 2 — natural-language payments**: complete — the chat interface turns free
  text into structured, deterministic payment intents, validates them, explains what it
  understood, and requires an explicit human confirmation before handing the intent to the
  pipeline. `@mova/ai` (parser, proposal-only) + `@mova/core` (`IntentValidator`) +
  `ChatPaymentInterface`. See `docs/nl-payments.md`.
- **Phase 2 — real Sui settlement (testnet)**: in progress — `SuiSettlementProvider`
  (`@mova/integrations`) settles native SUI on testnet with a REAL confirmed digest
  (`scripts/settle-real.ts`), and the web execute path attempts a real on-chain transfer via
  the connected wallet (gated) with an honest simulated fallback. Remaining: the custom Move
  smart-wallet contract (needs the Sui CLI) and mainnet validation. See `docs/roadmap.md`.
- **Phase 6 — risk assessment & Thetanuts hedging**: complete — deterministic `RiskEngine` +
  `HedgingEngine` + `HedgedRouteEngine` feed MOVA's final payment recommendation (route vs
  route+hedge); real Thetanuts V4 Optionbook provider (honest UNAVAILABLE fallback) + static
  dev fallback; `RiskAssessmentPanel` in the web shell; `npm run risk:demo`. See
  `docs/risk-hedging.md`.
- Next: Phase 1 core pipeline (Supabase backend + deterministic engines), then the Move smart-
  wallet contract + mainnet validation. See `docs/roadmap.md`.
