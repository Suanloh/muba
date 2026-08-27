# MOVA — AI-native Autonomous Payment Agent

> **Phase 0 — Project Foundation & Technical Blueprint.** This repository currently
> contains the technical foundation (architecture, data models, state machine,
> interfaces, config boundaries, deterministic mock layer) for MOVA. No feature
> code is implemented yet — that starts in Phase 1 per `docs/roadmap.md`.

> **Still need to be changed for this README**

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
| Backend / DB | **Supabase** (PostgreSQL, Auth, Realtime, Edge Functions) |
| LLM | **Google Gemini** (proposals only) |
| Settlement | **Sui — Mainnet target** (dev/test use devnet/testnet) |
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
docs/                 Phase 0 blueprint (start here)
packages/types        shared domain models + payment state machine
packages/config       env schema + dev/testnet/mainnet network configs
packages/logger       structured logging + error conventions
packages/core         deterministic engine contracts + state-machine runner
packages/qr           local EMVCo QR decoder (deterministic, no external call)
packages/integrations sponsor provider interfaces + deterministic mocks
apps/web              Next.js UI + Supabase client (Phase 1+)
supabase/             backend platform: Edge Functions, Auth, Realtime, Postgres
contracts/            Sui Move package (Phase 2+)
skills/               reusable skill pack (safety + architecture guidance)
```

## Read this first

| Document | What it answers |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Arch overview, layers, module responsibilities, repo structure |
| [`docs/data-model.md`](docs/data-model.md) | Entities & relationships (users, wallets, intents, routes, compliance, risk, approvals, txns, audit) |
| [`docs/state-machine.md`](docs/state-machine.md) | `CREATED → … → SETTLED/FAILED` payment lifecycle |
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

## Quick start (Phase 0)

```bash
npm install            # installs workspace deps (zod for config validation)
npm run typecheck      # type-checks all foundation packages
```

## Status

**Phase 0 in progress** — foundation established. See `docs/roadmap.md` for the
path to feature implementation.
