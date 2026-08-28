# MOVA — Technical Blueprint (Phase 0)

The Phase 0 foundation documents. Start with
[`architecture.md`](architecture.md) — it is the master document and links
everything else.

| Document | What it answers |
| --- | --- |
| [`architecture.md`](architecture.md) | Arch overview, safety principles, layers, module responsibilities, repo structure, trust boundaries |
| [`data-model.md`](data-model.md) | Entities & relationships (users, wallets, intents, routes, compliance, risk, approvals, txns, audit) |
| [`state-machine.md`](state-machine.md) | `CREATED → … → SETTLED/FAILED` payment lifecycle with guards |
| [`api-contracts.md`](api-contracts.md) | Internal module interfaces + HTTP API + event contracts + error contract |
| [`environment.md`](environment.md) | Environment-variable spec + dev/testnet/mainnet matrix |
| [`integration-strategy.md`](integration-strategy.md) | Sui / Thetanuts / market-data / screening: mock → real strategy |
| [`conventions.md`](conventions.md) | Logging & error-handling conventions |
| [`roadmap.md`](roadmap.md) | Phased delivery plan (Phase 1 → n) |
| [`trust.md`](trust.md) | Phase 8 — txn status, audit trail & trust layer (observability, explanation, notifications) |

The documents are backed by runnable foundation code:

| Concern | Code |
| --- | --- |
| Domain types & enums | `packages/types` |
| Payment state machine (states/events/guards) | `packages/types/src/payment-state.ts` + `packages/core/src/state-machine.ts` |
| Module contracts | `packages/core/src/interfaces.ts` |
| QR — local EMVCo decoder | `packages/qr` |
| Env schema & network boundaries | `packages/config` |
| Structured logging & errors | `packages/logger` |
| Provider interfaces + deterministic mocks | `packages/integrations` |
| Backend platform scaffold | `supabase/` |
| Smoke test proving the foundation | `scripts/phase0-smoke.ts` |

> These documents are the **contract of record** for MOVA. When a later phase
> changes a decision, update the document AND the corresponding foundation code
> in the same change.
