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

| Problem | Impact |
|---------|--------|
| **Capital Inefficiency** | Assets locked in yield protocols or sitting idle can't easily move for real-world payments |
| **Operational Friction** | Manual steps—cross-chain transfers, gas management, token swaps—are time-consuming, expensive, and error-prone |
| **Lack of Autonomy** | No systems understand user intent and automatically execute optimal transactions end-to-end |

Today's finance teams spend hours manually executing multi-step transactions. Tomorrow's finance should be natural language.

## 💡 The Solution

MOVA is a full-stack AI-native payment system that bridges blockchain liquidity with real-world payment rails:

```
User Intent → Parse → Route → Optimize → Comply → Score Risk → Approve → Execute → Audit
```

**Key insight:** Everything the AI proposes is *proposal only*. Deterministic engines validate; humans approve the exact plan; the wallet signs; value moves. Trust boundary is explicit and enforced in code.

### 9-Step Payment Lifecycle

1. **Intent Capture** — Natural language ("Pay RM200 to merchant") or EMVCo QR scan
2. **Intent Parse** — LLM interprets user request → typed `PaymentIntent` (no financial computation)
3. **Route Discovery** — Find execution paths across liquidity pools and payment rails
4. **Route Optimization** — Min-max scoring: gas, speed, steps, and risk (fully deterministic, auditable)
5. **Compliance Check** — Regulatory screening (fail-closed, non-blocking)
6. **Risk Assessment** — 7-point risk engine: balance, gas, recipient, network, slippage, route, complexity
7. **Hedge Decision** — Thetanuts-style structured products for FX/VaR exposure
8. **Human Approval** — Finance manager reviews and signs the exact plan digest
9. **Settlement & Audit** — Sui blockchain execution; immutable append-only audit trail; receipt + explanation

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
# Risk & hedging demo
npm run risk:demo

# Route optimization demo
npm run routing:demo

# QR code verification demo
npm run verify:qr

# Full integration test
npm run integration

# Run all tests
npm test

# Type checking
npm typecheck

# Linting
npm lint
```

## 🏗️ Architecture

### Monorepo Structure

MOVA is organized as an npm workspaces monorepo with **9 interdependent packages**:

```
mova/
├── apps/
│   └── web/                      # Next.js 14 App Router + TailwindCSS design system
│
├── packages/
│   ├── ai/                       # 🧠 AI Intent Parser (OpenAI/Gemini + Zod validation)
│   ├── core/                     # ⚙️  Six deterministic engines (plan, route, risk, etc.)
│   ├── wallet/                   # 🔐 Smart Wallet (ERC-4337 / Sui Account Abstraction)
│   ├── db/                       # 📊 Supabase ORM + migrations (8-stage payment lifecycle)
│   ├── integrations/             # 🔗 Liquidity pools (Aave, Compound, Uniswap) + Sui DEX APIs
│   ├── types/                    # 📋 Shared TypeScript types (cross-package contracts)
│   ├── config/                   # ⚙️  Network + deployment config
│   ├── logger/                   # 📝 Structured logging
│   └── qr/                       # 🔲 EMVCo QR parsing (local, no API)
│
├── contracts/                    # Solidity smart contracts (SmartWallet.sol, IntentRouter.sol)
├── data/                         # Sample data, test fixtures
├── docs/                         # Architecture, API, decisions, roadmap
└── scripts/                      # Demo runners, integration tests
```

### Core Engines

#### 1. **Intent Parser** (`packages/ai`)
- Parses natural language into typed `PaymentIntent`
- Uses OpenAI/Gemini **Structured Outputs** for deterministic JSON
- Re-validates with **Zod** before passing downstream
- **LLM responsibility:** interpretation only—never touches wallets, never computes figures

#### 2. **Planner** (`packages/core`)
- Generates candidate execution strategy families
- Identifies all assets and liquidity sources
- Maps intents to concrete execution paths

#### 3. **Route Optimizer** (`packages/core`)
- Deterministic **min-max weighted scoring model**
- Dimensions: gas cost, settlement time, execution steps, risk
- Provably optimal route ranking (not "what the AI guessed")

#### 4. **Compliance Engine** (`packages/core`)
- Regulatory screening (OFAC, sanctions, high-risk jurisdictions)
- Fail-closed: flags issues but never blocks
- Informs the human; final decision is theirs

#### 5. **Risk Engine** (`packages/core`)
- 7-point deterministic checks:
  - **Balance** (sufficient assets?)
  - **Gas** (enough for execution?)
  - **Recipient** (approved wallet? known entity?)
  - **Network** (supported chain? congestion risk?)
  - **Slippage** (price impact within tolerance?)
  - **Route Complexity** (number of hops, atomic vs. staged)
  - **Counterparty Risk** (DEX liquidity, bridge security)
- Weighted scoring formula: 0–100 risk score
- Reflects real-world payment risk priorities

#### 6. **Execution Engine** (`packages/core`)
- Builds validated, gas-optimized payloads
- Handles 6 typed error modes
- Coordinates Smart Wallet authorization
- Publishes immutable audit log to Supabase

### Smart Wallet (`packages/wallet`)
- **ERC-4337 Account Abstraction** (Sui compatible)
- **Incrementing nonces** (replay protection)
- **Reentrancy guards** with dedicated mock attacker test
- **Two-step ownership transfer** (secure ops)
- **Safe ERC-20 interoperability** (handles non-compliant tokens like USDT)
- 23 unit tests covering happy paths, auth failures, and attack vectors

### Data Layer (`packages/db`)
- **Supabase PostgreSQL** for the complete 8-stage payment lifecycle
- Every decision (parsing, routing, risk, approval) → typed event log
- Single SQL query traces any payment's full history
- Immutable append-only audit trail for compliance

### Integration & Routing (`packages/integrations`)
- Live liquidity discovery: **Aave**, **Compound**, **Uniswap**, Sui DEX aggregators
- Cross-chain bridge routing for EVM-compatible networks
- Smart gateway selection based on cost and execution time

### Shared Types (`packages/types`)
- TypeScript **contracts** for intents, routes, transactions, and API responses
- Enforced across all packages
- Enables type-safe end-to-end data flow

## 🔐 Security & Trustworthiness

### Design Principles

1. **Hard AI/Code Boundary**: LLM interprets *language only*. All financial computation, risk scoring, and route ranking come from pure deterministic code.
2. **Fail-Closed Compliance**: Regulatory checks flag issues but never silently fail.
3. **Human-in-the-Loop**: Every payment requires explicit human approval before funds move.
4. **Deterministic Scoring**: Route selection and risk assessment are auditable, explainable, and reproducible.

### Tested & Verified

- ✅ **23 unit tests** on SmartWallet (happy paths, auth failures, attack vectors)
- ✅ **Reentrancy guard** validated with dedicated attack contract
- ✅ **Integration tests** for full payment lifecycle
- ✅ **Type safety** with TypeScript strict mode + Zod re-validation
- ✅ **Audit trail**: every decision logged to Supabase with full context

## 📚 Documentation

Comprehensive documentation is available in [`docs/`](./docs):

| Document | Purpose |
|----------|---------|
| [`architecture.md`](./docs/architecture.md) | System design, component interactions, data flow |
| [`state-machine.md`](./docs/state-machine.md) | 9-step payment lifecycle state transitions |
| [`routing.md`](./docs/routing.md) | Route discovery, optimization, and scoring math |
| [`risk-hedging.md`](./docs/risk-hedging.md) | Risk engine, hedge decision logic, VaR/FX models |
| [`api-contracts.md`](./docs/api-contracts.md) | REST API endpoints and TypeScript contracts |
| [`data-model.md`](./docs/data-model.md) | Supabase schema, audit logs, lifecycle events |
| [`execution.md`](./docs/execution.md) | Wallet authorization, transaction building, settlement |
| [`nl-payments.md`](./docs/nl-payments.md) | Natural language parsing examples and edge cases |
| [`integration-strategy.md`](./docs/integration-strategy.md) | Liquidity pool integrations, DEX routing |
| [`environment.md`](./docs/environment.md) | Environment setup, secrets, deployment configs |
| [`roadmap.md`](./docs/roadmap.md) | Phase 0 → Phase 1+: scaling, new features, partnerships |
| [`judge-narrative.md`](./docs/judge-narrative.md) | Executive summary for audiences (judges, investors, partners) |


## 🛠️ Tech Stack

### Frontend
- **Next.js 14** (App Router)
- **TailwindCSS** (design system)
- **TypeScript** (strict mode)

### Backend
- **Express + TypeScript** (thin API layer)
- **Supabase PostgreSQL** (8-stage payment lifecycle + audit logs)
- **Structured Logging** (context + traceability)

### AI/ML
- **OpenAI GPT-4** / **Google Gemini** (Structured Outputs for deterministic parsing)
- **Zod** (schema validation)
- **Deterministic scoring models** (pure math, no LLM in critical path)

### Blockchain
- **Sui** (primary settlement network)
- **ERC-4337** (Account Abstraction)
- **Solidity** (SmartWallet.sol, IntentRouter.sol)
- **Hardhat** (local testing, 23 unit tests)

### Integrations
- **Aave, Compound** (yield protocols)
- **Uniswap** (DEX routing)
- **Thetanuts** (structured products for hedging)
- **EMVCo** (QR code standards)

### DevOps
- **TypeScript** (full-stack type safety)
- **npm workspaces** (monorepo coordination)
- **Hardhat** (contract testing & deployment)


For detailed guidelines, see the individual package READMEs in `packages/*/README.md`.

## 📜 License

MIT License — see [`LICENSE`](./LICENSE) for details.

## 👥 Authors

Built by **Suanloh** and the MOVA team.
-**Kong Zi Xuan**
-
-

Special thanks to the Web3 payment infrastructure community for inspiration and feedback.

## 📞 Support & Community

- **Issues**: [GitHub Issues](https://github.com/suanloh/mova/issues)
- **Discussions**: [GitHub Discussions](https://github.com/suanloh/mova/discussions)
- **Documentation**: [`docs/`](./docs/)

---


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
| [`docs/judge-narrative.md`](docs/judge-narrative.md) | **Final demo runbook** — differentiator → sponsor mapping, demo script, failure/safety matrix |

