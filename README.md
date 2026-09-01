# MOVA — AI-native Autonomous Payment Agent


> **MOVA lets users describe what they want to pay in plain language. MOVA finds
> the best route, checks compliance, manages financial exposure, and settles the
> payment on Sui — while keeping a human in control.**

MOVA turns a human payment intent (typed in natural language, or scanned from a
local EMVCo QR) into an audited, approved, executed settlement on **Sui**, with
risk management via **Thetanuts**-style structured products.

```
User Intent → AI Parsing → Route Discovery → Route Optimization → Compliance
→ Risk/Hedging → Human Approval → Wallet Authz → Sui Settlement → Status/Audit
```

Everything an AI suggests is *proposal only*; deterministic engines validate and
enforce; a human approves the exact plan digest; the wallet signs; only then does
value move.

## The story (one minute for a judge)

1. A user **says** (or scans) what they want to pay — e.g. *"Pay RM200 to this
   merchant."*
2. MOVA **parses** the intent (natural language, or a local **EMVCo QR** — no
   third-party API), and shows what it understood.
3. MOVA **finds the cheapest route** across rails and shows the math.
4. MOVA runs a fail-closed **regulatory compliance** screen.
5. MOVA **scores financial exposure** (VaR / FX) and decides whether a
   **Thetanuts hedge** is worth it — and explains it.
6. A **human approves** the plan digest; the **wallet signs**.
7. The payment **settles on Sui** — with a receipt, live status, and an
   **append-only audit trail** explaining every decision.

## Run the demo

```bash
npm install
npm run dev -w @mova/web        # open http://localhost:3000
```

Connect the built-in **MOVA Demo Wallet**, then:

| Step | What happens on screen |
| --- | --- |
| 1. Say it | Click **“Pay RM200 to this merchant.”** — MOVA parses the fiat amount and flags the unresolved merchant. |
| 2. Scan it | Paste the demo EMVCo payload in **Pay by QR** → *Decode payload* → **Confirm payment**. |
| 3. Review | MOVA shows the route + cost math, compliance verdict, risk score, and hedge decision. |
| 4. Approve | Tick *“I understand…”*, click **Approve payment**, then **Authorize & execute**. |
| 5. Verify | The 9-step lifecycle ends **SETTLED**; a **receipt**, the **audit trail**, and the **explanation** appear. |

One-click **Reset demo** clears the flow so you can run it again. Simulated
settlement is labeled honestly (“no value moves, no fabricated digest”); real
testnet settlement is one env flag + a funded wallet away, or provable directly
with `npx tsx scripts/settle-real.ts` (real confirmed on-chain digest).

## Verify the product (all offline & deterministic)

```bash
npm run typecheck    # 0 errors across all packages + web
npm test             # 214 tests (ai, core, db, integrations, qr, wallet)
npm run integration  # 94 checks: full NL + QR pipes, 11 failure modes, 6 AI-safety invariants
npm run smoke        # Phase 0 smoke: 37 checks
npm run verify:qr    # demo EMVCo QR payload decodes with a valid CRC
npm run build -w @mova/web   # clean production build
npm run dev -w @mova/web -- --port 3001
```

Also in this build: payments **persist to Supabase** (Postgres + Realtime, via the
`mova-sync` Edge Function — Settings → "Data layer · Supabase"; runs in-memory
and labels itself honestly when not configured), the audit report **exports a
branded PDF** (Activity → Audit trail → Export PDF), the **Thetanuts V4
OptionBook streams in realtime** (Settings → "Thetanuts OptionBook · realtime"),
and the **QR tab ships a real, scannable demo QR** (Load into scanner → decode →
confirm).

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
