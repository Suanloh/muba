# MOVA — AI Layer (packages/ai)

**Phase 0 placeholder.** Implemented in **Phase 1** (see `docs/roadmap.md`).

Contract (from `packages/core/src/interfaces.ts`):

- `IntentParser.parse(rawText, ctx)` → `ParsedIntentProposal` — structured
  output, retry-on-invalid, never invents amounts/recipients.
- Explanation polishing (deterministic explanations may have prose polished by
  the LLM, post-decision).

**Hard rule:** this package cannot import `ExecutionService`,
`SettlementProvider`, or approval code. The AI is proposal-only; the
deterministic core and human approval control execution.
