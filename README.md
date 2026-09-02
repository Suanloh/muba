# 🏦 MOVA — AI-Native Autonomous Payment Agent

> **MOVA transforms natural language payment instructions into fully audited, compliant blockchain transactions on Sui.**
>
> Users describe what they want to pay. MOVA parses intent, discovers optimal routes, validates compliance, manages financial exposure, and settles payments—**while keeping humans in control at every critical step.**

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.7-blue)](https://www.typescriptlang.org/)
[![Monorepo](https://img.shields.io/badge/monorepo-npm%20workspaces-blueviolet)](https://docs.npmjs.com/cli/v8/using-npm/workspaces)

</div>

## 🎯 The Problem

Web3 payment infrastructure suffers from three critical inefficiencies:

| Problem | Description | Impact |
| :--- | :--- | :--- |
| **Capital Inefficiency** | Assets locked in yield protocols or sitting idle cannot easily move for real-world payments. | Opportunity cost & restricted liquidity |
| **Operational Friction** | Manual steps like cross-chain transfers, gas management, and token swaps are slow, costly, and error-prone. | High user barrier & increased transaction costs |
| **Lack of Autonomy** | No systems currently exist that understand user intent and execute optimal transactions end-to-end. | Rigid UX & manual execution burden |

> Today's finance teams spend hours manually executing multi-step transactions. Tomorrow's finance should be natural language.

## 💡 The Solution

MOVA is a full-stack AI-native payment system that bridges blockchain liquidity with real-world payment rails:

```
User Intent → Parse → Route → Optimize → Comply → Score Risk → Approve → Execute → Audit
```

**Key insight:** Everything the AI proposes is *proposal only*. Deterministic engines validate; humans approve the exact plan; the wallet signs; value moves. Trust boundary is explicit and enforced in code.

### 9-Step Payment Lifecycle

| Step | Phase | Function | Key Mechanism |
| :---: | :--- | :--- | :--- |
| **1** | **Intent Capture** | Inputs user payload | Natural language (e.g., *"Pay RM200 to merchant"*) or EMVCo QR scan |
| **2** | **Intent Parse** | Converts request to typed struct | LLM parses request into typed `PaymentIntent` (no financial computation) |
| **3** | **Route Discovery** | Identifies viable execution paths | Scans liquidity pools and payment rails |
| **4** | **Route Optimization** | Ranks and selects optimal route | Min-max scoring on gas, speed, steps, and risk (deterministic & auditable) |
| **5** | **Compliance Check** | Ensures regulatory alignment | Regulatory screening (fail-closed, non-blocking) |
| **6** | **Risk Assessment** | Evaluates transaction parameters | 7-point risk engine: balance, gas, recipient, network, slippage, route, complexity |
| **7** | **Hedge Decision** | Manages financial exposure | Thetanuts-style structured products for FX/VaR risk mitigation |
| **8** | **Human Approval** | Final authorization gate | Finance manager reviews and signs the exact plan digest |
| **9** | **Settlement & Audit** | Executes transaction & logs data | Sui blockchain execution; immutable append-only audit trail; receipt + explanation |

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** workspaces-compatible version

### Installation & Demo

```bash
# Clone and install
git clone https://github.com/suanloh/mova.git
cd mova
npm install

# Run the development web UI
npm run dev -w @mova/web -- --port 3001
# Open http://localhost:3001 in your browser
```

### Demo Walkthrough

| Step | You do | MOVA does |
|------|--------|-----------|
| 1. **Say It** | Type or paste payment instruction | Parses natural language → flags unknowns (merchant, recipient, amount, account) |
| 2. **Scan It** | Paste EMVCo QR payload | Decodes locally (no third-party API); shows memo + amount |
| 3. **Review** | View proposed route, cost, compliance, risk, hedge | Shows cost math, regulatory verdict, risk score (0–100), hedge rationale |
| 4. **Approve** | Tick *"I understand the risks"* → click **Approve** | Wallet signs the exact plan digest (nothing more, nothing less) |
| 5. **Verify** | Watch 9-step execution live | Sui settlement confirms → receipt, audit trail, detailed explanation of every decision |

### Run Other Demos

```bash
npm run typecheck    # 0 errors across all packages + web
npm test             # 214 tests (ai, core, db, integrations, qr, wallet)
npm run integration  # 94 checks: full NL + QR pipes, 11 failure modes, 6 AI-safety invariants
npm run smoke        # Phase 0 smoke: 37 checks
npm run verify:qr    # demo EMVCo QR payload decodes with a valid CRC
npm run build -w @mova/web   # clean production build
npm run dev -w @mova/web -- --port 3001
```

## Full start

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

## Environment variables setup

Two env files, two scopes:

1. **Root `.env`** (server) — copy `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. **Web `.env.local`** (client, `NEXT_PUBLIC_*` only — **no secrets**) — copy
   `apps/web/.env.example`:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

`MOVA_ENV` selects the runtime boundary (`dev` | `testnet` | `mainnet`), enforced
fail-closed at boot by `checkBoundary()`:

| | `dev` | `testnet` | `mainnet` |
| --- | --- | --- | --- |
| Sui network | devnet | testnet | **mainnet** |
| Mocks | allowed | allowed | **refused (boot error)** |
| Settlement | simulated or real | simulated or real | **real only (forced)** |
| Funds | test/free | test tokens | **real** |

Key groups (full spec in [`docs/environment.md`](docs/environment.md), Zod schema in
`packages/config/src/env.ts`):

| Category | Environment variables |
|---|---|
| **Runtime** | `MOVA_ENV` |
| **Supabase** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` *(secret)*, `SUPABASE_JWT_SECRET` *(secret)*, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **AI (Gemini)** | `AI_PROVIDER`, `GEMINI_API_KEY` *(secret)*, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_MAX_TOOL_CALLS` |
| **Sui** | `SUI_NETWORK`, `SUI_RPC_URL`, `SUI_FAUCET_URL`, `SUI_PRIVATE_KEY` / `SUI_MNEMONIC` *(secret)*, `MOVA_PACKAGE_ID`, `MOVA_SMART_WALLET_ADDRESS` |
| **Settlement** | `SETTLEMENT_MODE` (`simulated` / `real`), `NEXT_PUBLIC_SETTLEMENT_MODE` |
| **Sponsors** | `USE_MOCKS`, `MARKET_DATA_PROVIDER`, `THETANUTS_VERSION`, `THETANUTS_OPTIONBOOK_ADDRESS`, `THETANUTS_NETWORK`, `THETANUTS_API_URL`, `THETANUTS_API_KEY` *(secret)*, `NEXT_PUBLIC_THETANUTS_RPC`, `SANCTIONS_LIST_PATH` |
| **QR** | `QR_STRICT_CRC` |
| **Logging** | `LOG_LEVEL`, `LOG_FORMAT`, `LOG_REDACT_FIELDS`, `AUDIT_RETENTION_DAYS` |
| **Policy** | `MANUAL_APPROVAL_THRESHOLD`, `MAX_DAILY_TXN` |

**Secrets** (`GEMINI_API_KEY`, `SUI_PRIVATE_KEY`, `SUI_MNEMONIC`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET`, `THETANUTS_API_KEY`) are never committed, never logged (field-name
redaction), and never returned by an API.

Also in this build:

- **Supabase:** Payments persist to Postgres and sync via Realtime through the `mova-sync` Edge Function. Falls back to in-memory storage when not configured.
- **Audit PDF:** Export a branded audit report from `Activity → Audit trail → Export PDF`.
- **Thetanuts V4:** OptionBook data streams in realtime via `Settings → Thetanuts OptionBook · realtime`.
- **QR Payments:** Includes a real, scannable demo QR — `Load into scanner → Decode → Confirm`.

`npm run integration` is the judge-facing harness: it drives the **exact web
pipeline** end-to-end and proves the 8 differentiators, every failure class, and
the AI-safety boundary (AI can't execute, can't bypass compliance, can't approve
its own payment, can't modify an approved spec). See
[`docs/judge-narrative.md`](docs/judge-narrative.md).

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

## Sponsor tools, APIs & infrastructure

MOVA is built on sponsor-provided building blocks. Every external dependency sits behind a
provider interface in `packages/integrations` with a **deterministic mock** for local/dev use and
a **real provider** swapped in by config (never by touching core engine code).



### Sponsors & Tools

| Sponsor / Tool | Used For | Notes |
|---|---|---|
| **Sui** (`@mysten/sui`, Move) | Main settlement network | `SuiSettlementProvider` Builds, simulates, signs & submits PTBs |
| **Thetanuts V4 / Optionbook** | Options & FX risk hedging | `ThetanutsHedgingProvider` (real V4 quotes) + `StaticThetanutsHedgingProvider` (dev fallback) |
| **Supabase** | Database, Auth & Realtime | Stores and streams payment data |
| **Google Gemini** | Intent parsing | Creates structured proposals only |
| **EMVCo QR** | Merchant QR decoding |  `packages/qr` On-device decoding + CRC validation |
| **Next.js + dApp Kit** | Web app & wallet | Used in `apps/web` |
| **QRCode** (`qrcode`) | Payment QR generation | Generates scannable demo QR |

Every provider exposes `descriptor: { kind: "MOCK" | "REAL", name, network }`; the audit trail
records which implementation produced each result. Migration mock → real is a **provider swap**
driven by `SETTLEMENT_MODE`, `MARKET_DATA_PROVIDER`, and `USE_MOCKS`. See
[`docs/integration-strategy.md`](docs/integration-strategy.md).

## Non-negotiable safety property

**The AI is never the final authority over money movement or compliance.**
AI parses, recommends, explains, and assists. Deterministic engines validate,
score, and enforce policy. A human approves irreversible value movement. The
deterministic systems and explicit human approval control execution. See
[`docs/architecture.md`](docs/architecture.md) — this is a compliance incident if
violated, not a style issue.

## Repository layout

```
docs/                 Blueprint + ownership model (start here)
packages/types        shared domain models + payment state machine
packages/config       env schema + dev/testnet/mainnet network configs
packages/logger       structured logging + error conventions
packages/core         deterministic engine contracts + state-machine runner + NL validator
packages/qr           local EMVCo QR decoder (deterministic, no external call)
packages/integrations sponsor provider interfaces + deterministic mocks
packages/wallet       Sui ownership layer: gate, authz, network, provider abstraction
packages/ai           NL payment parser — proposal-only, no execution
apps/web              Next.js wallet-connected app shell + natural-language payment chat
supabase/             Backend platform: Edge Functions, Auth, Realtime, Postgres
contracts/            Sui Move package — ownership blueprint (mova_owned.move)
skills/               Reusable skill pack (safety + architecture guidance)
```

## Smart contract

MOVA's on-chain ownership layer lives in [`contracts/mova`](contracts/mova) — a **Sui Move**
package (`mova`) that represents payment state as **Sui-owned objects** anchored to the user's
address. Nothing on-chain executes a payment by itself: it records ownership of already-approved,
settled state, and is only ever created from programmable transaction blocks the **user signs**.

**`contracts/mova/sources/mova_owned.move`** defines three Sui-owned objects:

| Object | Purpose |
| --- | --- |
| `MovaPaymentAuthz` | Wallet-scoped, human-approved payment authorization (carries a nonce + expiry for on-chain replay protection) |
| `OwnedPaymentRecord` | Deterministic payment record whose `state` mirrors the `@mova/types` state machine |
| `MovaReceipt` | Settlement receipt minted only after `SETTLED` (`tx_digest` empty when simulated) |

Entrypoints: `issue_authz`, `record_payment`, `update_state`, `mint_receipt`, plus read accessors
(`authz_amount`, `authz_recipient`, `authz_expires_at`, `record_state`, `record_amount`,
`receipt_digest`).

Published on **Sui testnet** (chain-id `4c78adac`, toolchain `sui 1.78.1`):

| Field | Value |
| --- | --- |
| Package id (`MOVA_PACKAGE_ID`) | `0x2baa7a782929b0b2af8cbbfeb20d7f75ac89db18103ae9f2e029858156ea55c2` |
| UpgradeCap (`MOVA_SMART_WALLET_ADDRESS`) | `0x72e285da7348564f54204eda23a1898762c085856f1f9cc51a231fd1039efe35` |

Build & test:

```bash
cd contracts/mova
sui move build                          # compiles (exit 0)
sui move test                           # unit tests (exit 0)
sui client publish                      # deploy (needs a sui client account + network gas)
npx tsx scripts/verify-publish.ts       # verify the published package
```

`Move.toml` pins the Sui framework to the target network (`framework/testnet` for testnet,
`framework/mainnet` for mainnet). See [`docs/ownership.md`](docs/ownership.md) and
[`docs/integration-strategy.md`](docs/integration-strategy.md).

## Documentation

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
| [`docs/routing.md`](docs/routing.md) | **Route discovery & mathematical route optimization** — route legs, cost breakdown, weighted scoring |
| [`docs/execution.md`](docs/execution.md) | **Human approval & payment execution** — `TransactionSpec`, plan digest, idempotency, failure taxonomy |
| [`docs/trust.md`](docs/trust.md) | Trust model — why AI proposals are never authority |
| [`docs/ui-ux-redesign.md`](docs/ui-ux-redesign.md) | UI/UX redesign notes for the web shell |
| [`docs/judge-narrative.md`](docs/judge-narrative.md) | **Final demo runbook** — differentiator → sponsor mapping, demo script, failure/safety matrix |

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


## Development roadmap

- [x] **— Foundation:** docs, types, core, config, logger, integrations, QR.
- [x] **— Wallet, ownership, app shell:** `@mova/wallet`, ownership model/docs, `contracts/mova`, web shell.
- [x] **— Natural-language payments:** parser (`@mova/ai`), intent validation, explicit user confirmation flow.
- [x] **— Risk + hedging recommendation:** deterministic risk/hedge engines and web risk panel.
- [x] **— Thetanuts V4 / Optionbook** — hedge quotes and executed hedges flowing
   through the same human-approval gate.
---
## Future plan

1. **Core pipeline (Supabase backend)** — finish the `supabase/` Edge Functions +
   `PaymentOrchestrator`, Postgres migrations with RLS + append-only `audit_events`
2. **Real Sui settlement completion** — write & publish the Move **smart-wallet
   execution package** (executor authorization, replay protection, safe token handling, ported
   from the `SMART_WALLET.md` EVM patterns), add `TOKEN_TRANSFER` payloads to
   `SuiSettlementProvider`, then validate the `mainnet` boundary against a funded wallet.
3. **Hardening & production readiness** — real screening/market-data providers,
   monitoring & alerting, retention, load + failure-injection + audit-integrity tests, and
   `mainnet` dry-run simulations.
4. **Beyond** — multi-rail support (onramp / DEX / fiat rail), richer structured products for
   hedging, and continuous compliance/audit hardening.

# ⚠️ Disclaimer

This project is a **hackathon prototype**.

The smart contracts and payment infrastructure have not been presented as production-grade financial infrastructure or as a substitute for a professional security audit.

Do not use real funds with experimental deployments.

---

# 👥 Team

| Name          | Role      |
| ------------- | --------- |
| KONG ZI XUAN  | Developer |
| -  | Developer |
| - | Developer |

---

# 📄 License

The smart contracts use the MIT SPDX license.

If the complete repository is intended to be open source, add an appropriate `LICENSE` file to the root of the repository.

---

# Acknowledgements

This project was developed as a hackathon prototype exploring the intersection of:

* Artificial Intelligence
* Agentic workflows
* Blockchain
* Sui
* Thetanuts V4
* Web3 payments
* Smart contracts
* Intent-based architecture
* EMVCo QR
* Monorepo

---



---
<p align="center">

**Built with LLM +  Blockchain +  Intent-Based Payments**

</p>
