# MOVA — Judge Narrative & Demo Runbook

> **One-line story:** *MOVA lets users describe what they want to pay. MOVA finds
> the best route, checks compliance, manages financial exposure, and settles the
> payment on Sui — while keeping a human in control.*

This document is the definitive judge-facing runbook: what to demo, where each
differentiator lives in the code, and how the product is verified.

---

## 1. The 8 differentiators → sponsor technology → where to see it

| # | Differentiator | Sponsor / tech | Where in the product |
| --- | --- | --- | --- |
| 1 | **Sui ownership & real settlement** | Sui (dApp-kit v2, `SuiGrpcClient`, Move package `contracts/mova`) | Ownership panel, real digest via `scripts/settle-real.ts`; browser path via `apps/web/lib/pipeline/real-settlement.ts` |
| 2 | **Natural-language payment intent** | Gemini (proposal only) + deterministic validator | “Pay by chat” — `packages/ai`, `packages/core/src/intent-validator.ts` |
| 3 | **Local EMVCo QR decoding** | Local EMVCo + CRC-16/CCITT (`packages/qr`) — no external API | “Pay by QR” scanner/paste |
| 4 | **Mathematical route optimization** | Deterministic routing engine (`packages/core/src/routing`) | Route # + cost math + savings shown in preview / Txn status |
| 5 | **Regulatory compliance gate** | Deterministic screening (`packages/core/src/execution/compliance.ts`) — fail-closed | Preview compliance verdict; sanctioned counterparty → BLOCKED, never approved |
| 6 | **Thetanuts-based risk/hedging** | Thetanuts V4 / Optionbook boundary (`packages/integrations/src/thetanuts.ts`) + deterministic VaR/hedge engine | Risk & hedging panel, route-vs-hedge table |
| 7 | **Human approval before money moves** | Wallet gate + `PaymentAuthz` bound to a plan digest (`packages/wallet`) | Preview acknowledgment → Approve → wallet signs |
| 8 | **Transparent txn status & audit trail** | Append-only audit projection (`packages/core/src/trace.ts`) | Txn status lifecycle (9 steps), Audit trail (10+ decisions), Payment explanation (6 questions) |

## 2. Recommended demo script (≈ 3 minutes, fully deterministic)

The browser demo runs in **simulated** settlement mode by default so every run
completes to a receipt + audit trail, and is clearly labeled (“no value moves,
no fabricated digest”). Real on-chain settlement is provable separately.

1. **Say it** — click *“Pay RM200 to this merchant.”* MOVA parses “200 RM to this
   merchant”, flags it as **fiat + unresolved merchant**, and points the user to
   the QR scanner. *(Differentiators 2, 3)*
2. **Scan it** — paste the demo EMVCo payload → *Decode payload*. MOVA shows the
   merchant, fiat amount, and currency, then asks the user to settle in a Sui
   token (USDC). *(3)*
3. **Confirm** — *Confirm payment*. MOVA runs the full deterministic pipe.
4. **Review** — the preview shows the **selected route + exact scoring math**,
   **savings vs the worst route**, the **compliance verdict**, the **risk score
   (band + signals + math)**, and the **hedge decision**. *(4, 5, 6)*
5. **Approve** — tick “I understand…” (the acknowledgment is bound to the plan
   digest) → *Approve payment*. A wallet-scoped `PaymentAuthz` is issued for
   exactly the approved digest. *(7)*
6. **Execute** — *Authorize & execute*. The wallet signs the authorization; the
   lifecycle advances to **SETTLED**. *(1, 7)*
7. **Verify** — the **9-step lifecycle**, the **receipt**, the **audit trail**
   (Original intent → Parsed → Route → Compliance → Risk → Hedge → Approval →
   Execution → Settled), and the **6-question Payment explanation** all appear.
   *(8)*
8. **Safety** — *Simulate AI auto-execute (no approval)* → **BLOCKED (fail
   closed)**. *(AI safety)*
9. **Reset** — *Reset demo* clears the slate for a repeatable run.

> Demo QR payload: `0002010102120205M0001520454115303458540510.005802MY5918MOVA TEST MERCHANT6002KL6304EA78`

## 3. Failure & safety coverage (`npm run integration`, 94 checks)

**Failure modes** (each fails closed + stays honest):

- Invalid payment (no amount) — cannot be confirmed
- Ambiguous intent (“this merchant”) — clarification, not confirmable
- Invalid QR (tampered payload) — CRC fail → blocked
- Compliance rejection (sanctioned counterparty) — **BLOCKED**, never approved
- Insufficient funds — `INSUFFICIENT_BALANCE` before the wallet signs
- Wallet rejection — `USER_REJECTED`
- Failed txn (real submission fails) — honest **simulated fallback**, no fake digest
- External API failure (price feed down) — typed engine failure, flow fails closed
- Thetanuts unavailable — hedge reports `UNAVAILABLE`, never a fake live quote
- Sui unavailable — honest best-effort pre-flight, nothing moves
- Duplicate execution attempt — `IDEMPOTENCY_VIOLATION`

**AI-safety invariants (all verified):**

- AI cannot directly execute transactions (gate refuses without human approval)
- AI cannot bypass compliance (deterministic gate re-runs on every plan)
- AI cannot approve its own payment (authz only from a human APPROVE)
- AI cannot modify an already-approved txn (spec digest integrity + authz binding)
- Execution uses only validated structured data (never raw LLM output)
- Human approval is mandatory (execute-without-approval is refused)

## 4. Real Sui settlement (proven, not claimed)

- `scripts/settle-real.ts` — settles real SUI on **testnet** via
  `SuiSettlementProvider` and returns a **confirmed on-chain digest**
  (`simulated: false`). It is never mocked: a missing/failed chain read is
  reported honestly.
- Browser real mode: `NEXT_PUBLIC_SETTLEMENT_MODE=real` (in `apps/web/.env.local`)
  + a funded testnet wallet → the browser attempts a **real** settlement and falls
  back to simulated **only** with the reason recorded.
- The Move ownership blueprint is published on testnet (`contracts/mova`,
  `MOVA_PACKAGE_ID` in `.env`; verify with `scripts/verify-publish.ts`).

## 5. Honesty invariants (the product never lies)

1. Simulated settlement returns `txDigest = null`, `simulated = true` — a digest
   is **never fabricated**.
2. Static/dev data is flagged `STATIC_DEV` / `simulated`; a down Thetanuts
   integration reports `UNAVAILABLE` — never a fake live quote.
3. The AI never contributes to a transaction spec — every spec is rebuilt from
   validated state and its SHA-256 digest is what the human approves.
4. Compliance fails closed: engine error ⇒ REVIEW/BLOCK, never ALLOW.
