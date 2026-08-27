# MOVA — AI Layer (packages/ai)

**Phase 2 — implemented.** Natural-language payment parsing: converts free text
into structured, schema-validated intents (proposal-only).

## Modules

| File | Responsibility |
| --- | --- |
| `extract.ts` | Deterministic NL → structured intent extractor (no secrets, no network). |
| `llm.ts` | Optional LLM structured-output path (Gemini) — schema-constrained, retry-on-invalid, **never executable instructions**. |
| `parser.ts` | `NlIntentParser` — LLM when configured, deterministic otherwise. |
| `conversation.ts` | Lightweight session context: turn thread + working intent, follow-up merge + corrections, confirm/cancel. |
| `explain.ts` | Plain-language statement of what MOVA understood (shown before confirmation). |

## Hard rules

- **Proposal only.** Output is `StructuredIntentProposal` — data, never
  transaction instructions/bytes. The LLM JSON schema forbids executable fields
  (`additionalProperties: false`).
- **No money computed here.** The parser reports `amountRaw` + `currencyInput`;
  `@mova/core` is the only place that computes `Money`.
- **No execution, no approval.** This package cannot import execution,
  settlement, or approval code. Human confirmation + the deterministic pipeline
  control everything.
- Missing/ambiguous values become `needsClarification`, never guesses.

The `IntentParser` contract (from `packages/core/src/interfaces.ts`) remains
the reference interface; `NlIntentParser` implements it for the NL layer. See
[`docs/nl-payments.md`](../../docs/nl-payments.md) for the full design.
