/**
 * Natural-language payment orchestration (Phase 2).
 *
 * Bridges the `@mova/ai` conversational parser to the existing deterministic
 * demo pipeline:
 *
 *   NL text → StructuredIntentProposal (@mova/ai) → Validation (@mova/core)
 *   → Explanation → USER CONFIRMATION → existing pipeline (createFlow)
 *
 * MOVA is a parser and assistant only. It never executes, approves, or bypasses
 * compliance. Confirmation is required before anything is handed to the
 * payment pipeline.
 */
import type {
  IntentParserContext,
  Network,
  ValidatedStructuredIntent,
} from "@mova/types";
import { formatMoney } from "./format";
import { resolveDemoRecipient } from "./demo-contacts";

/** Build the parser context for a connected wallet session. */
export function nlParserContext(opts: {
  userId: string;
  walletId: string;
  network: Network;
  now?: number;
}): IntentParserContext {
  return {
    userId: opts.userId,
    walletId: opts.walletId,
    network: opts.network,
    resolveRecipient: resolveDemoRecipient,
    now: opts.now,
  };
}

/**
 * A validated intent can only be confirmed when it has no blocking errors, no
 * open clarification, and a settleable (token) amount. Fiat intents require a
 * conversion first.
 */
export function canConfirmIntent(validated: ValidatedStructuredIntent | null): boolean {
  if (!validated) return false;
  return (
    validated.ok &&
    !validated.needsClarification &&
    validated.canonicalAmount !== null &&
    validated.proposal !== null
  );
}

/**
 * Convert a confirmed validated intent into the raw-text form the existing
 * demo pipeline (`createFlow` → `parseDemoIntent`) understands. Returns null
 * when there is no settleable token amount.
 */
export function buildPipelineText(validated: ValidatedStructuredIntent): string | null {
  if (!validated.ok || !validated.proposal) return null;
  const p = validated.proposal;
  if (!validated.canonicalAmount) return null; // fiat — needs conversion first
  const amount = formatMoney(validated.canonicalAmount);
  const verb = p.action === "PAY" ? "Pay" : "Send";
  const purpose = p.purpose ? ` for ${p.purpose}` : "";
  return `${verb} ${amount} to ${p.recipient.value}${purpose}`;
}

/** Short human summary of a confirmed intent (for notifications/toasts). */
export function intentSummary(validated: ValidatedStructuredIntent): string {
  const p = validated.proposal;
  if (!p) return "payment";
  const amount = validated.canonicalAmount
    ? formatMoney(validated.canonicalAmount)
    : `${p.amountRaw ?? "?"} ${p.currencyInput}`.trim();
  const who = p.recipient.name ?? p.recipient.value;
  return `${amount} to ${who}`;
}
