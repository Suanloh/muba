# Reusable Skill Pack — AI-Assisted Development of Fintech, Blockchain, Compliance & Agentic Finance

> A distilled, project-agnostic knowledge base for coding agents. Each skill below is
> deliberately **generic and reusable**: no project names, no branding, no wallet
> addresses, no mock data, no hackathon-specific details. Use these skills to make an
> AI agent inspect, extend, and build financial systems correctly instead of guessing.

## How to use this pack

- Each skill answers: **what it is, when to use it, why it exists, the problem it solves,
  core concepts, recommended architecture, implementation patterns, common mistakes,
  security considerations, an example agent instruction, and related skills.**
- Skills are grouped by domain, not by any single codebase.
- A skill may apply far beyond blockchain (e.g. a Policy Engine applies to payments,
  banking, enterprise approval workflows, fraud detection, and access control).
- Load only the skills relevant to the task. See [§ When to load each skill](#when-to-load-each-skill).

---

## Skill hierarchy

```
skills/
├── ai/
│   ├── financial-intent-parsing/
│   ├── agentic-workflow-design/
│   └── structured-llm-output/
├── blockchain/
│   ├── wallet-integration/
│   ├── digital-asset-transfers/
│   └── smart-contract-execution/
├── fintech/
│   ├── digital-asset-treasury/
│   ├── portfolio-monitoring/
│   └── transaction-risk/
├── compliance/
│   ├── compliance-gate/
│   ├── counterparty-screening/
│   ├── transaction-monitoring/
│   ├── risk-scoring/
│   ├── policy-engine/
│   ├── travel-rule/
│   └── audit-trail/
├── arch/
│   ├── ai-deterministic-boundary/
│   └── fintech-system-architecture/
├── impeccable/
│   ├── impeccable-code-quality/
│   └── flawless-delivery/
└── dev/
    └── ai-assisted-existing-codebase/
```

---

## Skill files by theme

Each theme is split into its own file:

| Theme | File | Skills |
|---|---|---|
| AI | [`skills/ai.md`](skills/ai.md) | `financial-intent-parsing`, `agentic-workflow-design`, `structured-llm-output` |
| Blockchain | [`skills/blockchain.md`](skills/blockchain.md) | `wallet-integration`, `digital-asset-transfers`, `smart-contract-execution` |
| Fintech | [`skills/fintech.md`](skills/fintech.md) | `digital-asset-treasury`, `portfolio-monitoring`, `transaction-risk` |
| Compliance | [`skills/compliance.md`](skills/compliance.md) | `compliance-gate`, `counterparty-screening`, `transaction-monitoring`, `risk-scoring`, `policy-engine`, `travel-rule`, `audit-trail` |
| Architecture | [`skills/architecture.md`](skills/architecture.md) | `ai-deterministic-boundary`, `fintech-system-architecture` |
| Quality | [`skills/impeccable.md`](skills/impeccable.md) | `impeccable-code-quality`, `flawless-delivery` |
| Development | [`skills/development.md`](skills/development.md) | `ai-assisted-existing-codebase` |

---

# Final Reference

## A. Complete skill pack structure

```
skills/
├── ai/
│   ├── financial-intent-parsing
│   ├── agentic-workflow-design
│   └── structured-llm-output
├── blockchain/
│   ├── wallet-integration
│   ├── digital-asset-transfers
│   └── smart-contract-execution
├── fintech/
│   ├── digital-asset-treasury
│   ├── portfolio-monitoring
│   └── transaction-risk
├── compliance/
│   ├── compliance-gate
│   ├── counterparty-screening
│   ├── transaction-monitoring
│   ├── risk-scoring
│   ├── policy-engine
│   ├── travel-rule
│   └── audit-trail
├── arch/
│   ├── ai-deterministic-boundary
│   └── fintech-system-architecture
├── impeccable/
│   ├── impeccable-code-quality
│   └── flawless-delivery
└── dev/
    └── ai-assisted-existing-codebase
```

## B. Essential skills (load for any financial/agentic feature)

| Skill | Why essential |
|---|---|
| `ai-deterministic-boundary` | The core safety property: AI must not be the final authority for money/compliance. |
| `fintech-system-architecture` | Correct layering; where any feature belongs. |
| `financial-intent-parsing` | The entry point converting language to structure. |
| `policy-engine` | Deterministic ALLOW/REVIEW/BLOCK before execution. |
| `audit-trail` | Traceability from intent to on-chain result. |
| `ai-assisted-existing-codebase` | Prevents rewrites and duplicate features on any task. |

## C. Optional skills (load when the task touches that domain)

| Skill | Load when |
|---|---|
| `structured-llm-output` | The LLM must return typed data. |
| `agentic-workflow-design` | Building multi-step agent/orchestration flows. |
| `wallet-integration` | Connecting or signing with wallets. |
| `digital-asset-transfers` | Moving tokens (USDC/USDT/native). |
| `smart-contract-execution` | Calling deployed contracts. |
| `digital-asset-treasury` | Treasury/custody/operating-wallet design. |
| `portfolio-monitoring` | Valuations, allocation, concentration. |
| `transaction-risk` | Pre-execution financial risk checks. |
| `compliance-gate` | Mandatory compliance gate in the pipeline. |
| `counterparty-screening` | Sanctions/watchlist checks. |
| `transaction-monitoring` | AML-style pattern surveillance. |
| `risk-scoring` | Deterministic LOW/MEDIUM/HIGH/CRITICAL scoring. |
| `travel-rule` | Cross-institution originator/beneficiary data. |

## D. When a coding agent should load each skill

| Task trigger | Skills to load |
|---|---|
| "Parse a payment/instruction from text" | `financial-intent-parsing`, `structured-llm-output` |
| "Build an agent/orchestrator/planner" | `agentic-workflow-design`, `ai-deterministic-boundary` |
| "Connect a wallet / sign / send" | `wallet-integration`, `digital-asset-transfers` |
| "Call a contract / simulate / gas" | `smart-contract-execution`, `digital-asset-transfers` |
| "Treasury / custody / operating wallet" | `digital-asset-treasury`, `portfolio-monitoring`, `policy-engine` |
| "Risk check before a transaction" | `transaction-risk`, `risk-scoring` |
| "Compliance gate / screening / monitoring" | `compliance-gate`, `counterparty-screening`, `transaction-monitoring` |
| "Add rules / limits / approval thresholds" | `policy-engine`, `audit-trail` |
| "Travel rule / counterparty data" | `travel-rule`, `counterparty-screening` |
| "Logging / audit / traceability" | `audit-trail` |
| "New feature / bug fix on existing code" | `ai-assisted-existing-codebase`, `fintech-system-architecture` |
| "Any AI + money/compliance design" | `ai-deterministic-boundary` (always) |

## E. Skills NOT loaded for ordinary coding tasks

For routine, non-financial tasks (UI styling, generic CRUD, docs, tooling), **do not load**
the domain-heavy skills — they add noise and slow decisions. Specifically, skip:

- `blockchain/*` (unless the task touches chains, tokens, or contracts)
- `fintech/*` (unless treasury, portfolio, or transaction risk is involved)
- `compliance/*` (unless the task is about rules, screening, monitoring, or audit of value movement)
- `financial-intent-parsing` and `agentic-workflow-design` (unless AI is parsing language or orchestrating steps)

For ordinary tasks, load only:

- `ai-assisted-existing-codebase` — always, to avoid rewrites.
- `fintech-system-architecture` — when the change spans layers or touches the data model.
- `ai-deterministic-boundary` — if the change is anywhere near a decision or execution path.

---

*This pack is a living reference. Keep skills generic and reusable; do not embed project
names, branding, wallet addresses, mock data, screenshots, or hackathon-specific details.*
