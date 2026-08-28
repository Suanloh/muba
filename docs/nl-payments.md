# MOVA — Natural-Language Payments & Intent Parsing (Phase 2)

> **Phase 2 deliverable.** A conversational payment interface that converts
> natural language into deterministic, structured payment intents and requires
> an explicit human confirmation before anything reaches the payment pipeline.

```text
User text (chat) ─► IntentParser (proposal only)
        │  @mova/ai: extract slots + (optional) LLM structured output
        ▼
StructuredIntentProposal   (no executable instructions, no Money — raw values)
        │  @mova/core: IntentValidator (deterministic)
        ▼
ValidatedStructuredIntent  (canonical amount recomputed, 8 issue categories)
        │  @mova/ai: explainIntent
        ▼
Explanation  "I understand: send 200 USDC to Alice on Sui Testnet."
        │
        ▼
USER CONFIRMATION ─► existing pipeline (approval → wallet authz → settlement)
```

## 1. Objective

Users describe a payment in natural language; MOVA converts it into a
deterministic, structured intent. Examples:

- "Pay Alice $200 USDC."
- "Send RM100 to Bob."
- "Pay this merchant."
- "Send 50 USDC to this wallet on Sui."

## 2. Safety boundary (non-negotiable)

**The AI parser is a parser and assistant. It is NOT:**

- a transaction executor (it never builds or emits transaction instructions),
- a compliance authority (it never decides ALLOW/REVIEW/BLOCK),
- the final payment authority (a human must confirm).

Concretely:

- `StructuredIntentProposal` carries **no** transaction bytes, payload, gas, or
  execution parameters. The LLM JSON schema (`@mova/ai` `buildExtractionSchema`)
  has `additionalProperties: false` and no executable fields.
- The parser reports only what it saw (`amountRaw`, `currencyInput`). The
  deterministic validator (`@mova/core`) is the **only** place that computes
  money (`canonicalAmount`).
- The AI output is a *suggestion*; validation is the authority; confirmation is
  a human gate; execution still requires approval + wallet authz (`@mova/wallet`).

## 3. Pipeline

| Stage | Module | Responsibility |
| --- | --- | --- |
| **Extraction** | `@mova/ai` (`extract.ts`) | Deterministic slot filling: action, amount, currency, recipient, network, purpose, timing, constraints, payment method. Marks ambiguity instead of guessing. |
| **LLM path (optional)** | `@mova/ai` (`llm.ts`) | Schema-constrained structured output, retry-on-invalid, proposal-only. Used server-side when an API key is configured; falls back to deterministic. |
| **Validation** | `@mova/core` (`intent-validator.ts`) | Recomputes money, classifies the 8+ issue categories, sets `ok` / `canonicalAmount` / clarification. Pure and deterministic. |
| **Conversation** | `@mova/ai` (`conversation.ts`) | Lightweight session context: turn thread + accumulated working intent; follow-up merge + correction detection; confirm/cancel meta-intents. |
| **Explanation** | `@mova/ai` (`explain.ts`) | States what MOVA understood in plain language + field detail, marking what was parsed vs inferred vs missing. |
| **Confirmation** | `apps/web` (`ChatPaymentInterface.tsx`) | Human gate: user must confirm before the intent is handed to the pipeline. |

## 4. Intent extraction (structured fields)

| Field | Examples | Notes |
| --- | --- | --- |
| `action` | PAY / TRANSFER / BATCH_PAY | From leading verb. |
| `amountRaw` | "200", "100.50" | Decimal **as typed** — never computed by the AI. |
| `currencyInput` | "USDC", "RM", "$" | Normalized via the shared registry (`@mova/types/nl-assets.ts`). |
| `recipient` | address / email / @handle / name | Bare names resolved via the contact book; unknown names and generic phrases ("this merchant") are **ambiguous**. |
| `network` | SUI_TESTNET / DEVNET / MAINNET | MOVA is Sui-only; other chains → unsupported. Bare "Sui" → expected runtime network. |
| `purpose` | "for payroll" | Memo. |
| `timing` | now / by Friday / tomorrow | Resolved to ISO-8601 deterministically. |
| `constraints` | max fee 1 SUI, by Friday, urgent | Fee caps / spend caps / timing / speed. |
| `paymentMethod` | wallet balance, batch | Unsupported methods (card, PayPal) → warning. |

## 5. Validation matrix (`@mova/core`)

| Code | Severity | Trigger |
| --- | --- | --- |
| `MISSING_AMOUNT` | error | No amount found. |
| `INVALID_AMOUNT` | error | Non-numeric / zero / too many decimals. |
| `MISSING_CURRENCY` | error | Amount present, no token stated. |
| `UNSUPPORTED_CURRENCY` | error / warning | Unknown symbol (error); fiat like MYR/USD (warning — conversion required). |
| `MISSING_RECIPIENT` | error | No recipient. |
| `INVALID_ADDRESS` | error | Address-like token that isn't a valid Sui address. |
| `AMBIGUOUS_RECIPIENT` | error | Unresolvable name or generic phrase → ask. |
| `UNSUPPORTED_NETWORK` | error | Non-Sui chain named. |
| `CONFLICTING_INSTRUCTIONS` | error / warning | Two amounts/currencies/recipients, or an uncorrected change vs. the working draft. |
| `UNSUPPORTED_PAYMENT_METHOD` | warning | Card/PayPal etc. — falls back to wallet balance. |

Errors block confirmation; warnings are surfaced to the user; any
`needsClarification` intent asks a precise follow-up question rather than
guessing.

## 6. Conversation context (lightweight, session-only)

- `PaymentConversation` keeps only: `turns` (thread) + `workingIntent`
  (accumulated, validated draft) + `confirmed` + `submittedRecordId`.
- Follow-ups complete or correct the draft ("in USDC", "make it 300", "send to
  Bob instead"). Correction markers (`instead`, `actually`, `change to`…) avoid
  false "conflicting instructions".
- Meta intents: `yes/confirm/send it` → mark confirmed; `cancel/reset` → clear.
- **No long-term memory system.** Context dies with the session by design.

## 7. Tests

- `packages/core` — validator matrix (16 tests).
- `packages/ai` — extraction, conversation, explanation, LLM guard (33 tests).

Run: `npm run test -w @mova/core` and `npm run test -w @mova/ai`.
