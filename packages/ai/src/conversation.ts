/**
 * Lightweight session-based payment conversation (Phase 2).
 *
 * Deliberately NOT a long-term memory system. It keeps only the current turn
 * thread + the accumulated "working intent" for the session. Follow-up messages
 * can complete or correct the draft ("send it tomorrow", "actually make it 300"),
 * but every change is re-validated deterministically and re-explained before the
 * user confirms. Context dies with the session.
 */
import { validateStructuredProposal } from "@mova/core";
import type {
  ConversationTurn,
  IntentParserContext,
  NlTurnResult,
  PaymentConversation,
  StructuredIntentProposal,
  ValidatedStructuredIntent,
} from "@mova/types";
import { explainIntent } from "./explain.js";
import { extractStructuredProposal } from "./extract.js";

// ---------------------------------------------------------------------------
// Conversation lifecycle
// ---------------------------------------------------------------------------

export function createPaymentConversation(sessionId?: string): PaymentConversation {
  return {
    sessionId: sessionId ?? crypto.randomUUID(),
    turns: [],
    workingIntent: null,
    confirmed: false,
    submittedRecordId: null,
  };
}

export function resetConversation(): PaymentConversation {
  return createPaymentConversation();
}

export function appendTurn(
  conv: PaymentConversation,
  role: ConversationTurn["role"],
  text: string,
  now: number,
): PaymentConversation {
  const turn: ConversationTurn = { id: crypto.randomUUID(), role, text, at: now };
  return { ...conv, turns: [...conv.turns, turn] };
}

// ---------------------------------------------------------------------------
// Meta intents (confirm / cancel)
// ---------------------------------------------------------------------------

const CONFIRM_RE =
  /^(?:yes|y|confirm|approve|send it|send|go ahead|proceed|do it|ok|okay|sure|sounds good|looks good|that'?s right|correct)$/i;
const CANCEL_RE =
  /^(?:cancel|stop|abort|never mind|nevermind|reset|clear|discard|no|nope|not that)$/i;

export function detectMetaIntent(text: string): "confirm" | "cancel" | "none" {
  const t = text.trim();
  if (CONFIRM_RE.test(t)) return "confirm";
  if (CANCEL_RE.test(t)) return "cancel";
  return "none";
}

// ---------------------------------------------------------------------------
// Follow-up merge (accumulate + correct, deterministically)
// ---------------------------------------------------------------------------

/** Markers that signal an intentional correction rather than a contradiction. */
const CORRECTION_RE = /\b(?:change|update|set|make it|instead|actually|revise|correct|no wait|wait|rather)\b/i;

export interface MergedProposal {
  proposal: StructuredIntentProposal;
  /** Fields carried forward from the working intent (shown as "inferred"). */
  inferred: string[];
}

/**
 * Merge a fresh parse into the accumulated working intent. Missing fields are
 * carried forward from context; explicit values overwrite. A changed value with
 * no correction marker is recorded as a cross-turn conflict (warning-level).
 */
export function mergeWithWorking(
  working: ValidatedStructuredIntent | null,
  next: StructuredIntentProposal,
  _ctx: IntentParserContext,
): MergedProposal {
  // Carry the accumulated draft forward even when it isn't fully valid yet —
  // a partial draft (amount + recipient, missing currency) is completed by
  // follow-ups ("in USDC").
  const base = working?.proposal ?? null;
  if (!base) return { proposal: next, inferred: [] };

  const inferred: string[] = [];
  const merged: StructuredIntentProposal = { ...next, conflicts: [...next.conflicts] };

  if (next.amountRaw === null && base.amountRaw !== null) {
    merged.amountRaw = base.amountRaw;
    merged.currencyInput = merged.currencyInput || base.currencyInput;
    inferred.push("amount", "currency");
  } else if (next.amountRaw !== null && base.amountRaw !== null && next.amountRaw !== base.amountRaw) {
    if (!CORRECTION_RE.test(next.rawText)) {
      merged.conflicts.push(
        `amount changed from ${base.amountRaw} to ${next.amountRaw} without a correction`,
      );
    }
  }

  if (next.currencyInput === "" && base.currencyInput !== "") {
    merged.currencyInput = base.currencyInput;
    if (!inferred.includes("currency")) inferred.push("currency");
  } else if (
    next.currencyInput !== "" &&
    base.currencyInput !== "" &&
    next.currencyInput.toLowerCase() !== base.currencyInput.toLowerCase()
  ) {
    if (!CORRECTION_RE.test(next.rawText)) {
      merged.conflicts.push(
        `currency changed from ${base.currencyInput} to ${next.currencyInput} without a correction`,
      );
    }
  }

  if (next.recipient.value === "" && base.recipient.value !== "") {
    merged.recipient = base.recipient;
    inferred.push("recipient");
  } else if (
    next.recipient.value !== "" &&
    base.recipient.value !== "" &&
    next.recipient.value.toLowerCase() !== base.recipient.value.toLowerCase()
  ) {
    if (!CORRECTION_RE.test(next.rawText)) {
      merged.conflicts.push(
        `recipient changed from ${base.recipient.name ?? base.recipient.value} to ${next.recipient.name ?? next.recipient.value} without a correction`,
      );
    }
  }

  if (next.networkMentioned === "none" && base.network) {
    merged.network = base.network;
    merged.networkMentioned = base.networkMentioned === "unsupported" ? "unsupported" : "none";
    if (!inferred.includes("network")) inferred.push("network");
  }

  if (next.purpose === null && base.purpose !== null) {
    merged.purpose = base.purpose;
    if (!inferred.includes("purpose")) inferred.push("purpose");
  }

  if (next.scheduleAt === null && next.timingLabel === null && base.scheduleAt !== null) {
    merged.scheduleAt = base.scheduleAt;
    merged.timingLabel = base.timingLabel;
    if (!inferred.includes("timing")) inferred.push("timing");
  }

  if (next.paymentMethod === null && base.paymentMethod !== null) {
    merged.paymentMethod = base.paymentMethod;
    if (!inferred.includes("paymentMethod")) inferred.push("paymentMethod");
  }

  return { proposal: merged, inferred };
}

// ---------------------------------------------------------------------------
// Turn processing (parse → merge → validate → explain → reply)
// ---------------------------------------------------------------------------

function buildReply(
  result: Pick<NlTurnResult, "validated" | "explanation" | "meta">,
): string {
  if (result.meta === "confirm") return "Confirmed — I'll prepare this payment for your approval.";
  if (result.meta === "cancel") return "Cancelled — the draft is cleared. Describe a new payment when you're ready.";

  const validated = result.validated;
  if (!validated || !result.explanation) return "I didn't understand that — could you rephrase the payment?";

  if (validated.ok) {
    const base = result.explanation.summary;
    const extras: string[] = [];
    if (result.explanation.notes.length > 0) extras.push(result.explanation.notes[0] ?? "");
    return extras.length > 0 ? `${base}\n${extras.join(" ")}` : base;
  }

  const firstError = validated.errors[0];
  return firstError ? firstError.message : "This payment can't be validated yet — I need more detail.";
}

/**
 * Process one user message against a conversation.
 * Pure — returns a new conversation + the turn result.
 */
export function processTurn(
  conv: PaymentConversation,
  userText: string,
  ctx: IntentParserContext,
  now = Date.now(),
): { conversation: PaymentConversation; result: NlTurnResult } {
  const meta = detectMetaIntent(userText);

  // --- Meta: confirm --------------------------------------------------------
  if (meta === "confirm") {
    if (conv.workingIntent?.ok) {
      const next = { ...conv, confirmed: true, turns: [...conv.turns] };
      return {
        conversation: appendTurn(appendTurn(next, "user", userText, now), "mova", "Confirmed — I'll prepare this payment for your approval.", now),
        result: {
          proposal: conv.workingIntent.proposal,
          validated: conv.workingIntent,
          explanation: null,
          meta,
          reply: "Confirmed — I'll prepare this payment for your approval.",
        },
      };
    }
    const err: NlTurnResult = {
      proposal: null,
      validated: null,
      explanation: null,
      meta,
      reply: "There's nothing to confirm yet — describe a payment first, or say 'cancel' to start over.",
    };
    return {
      conversation: appendTurn(appendTurn(conv, "user", userText, now), "mova", err.reply, now),
      result: err,
    };
  }

  // --- Meta: cancel / reset -------------------------------------------------
  if (meta === "cancel") {
    const fresh = { ...resetConversation(), turns: [...conv.turns] };
    const reply = "Cancelled — the draft is cleared. Describe a new payment when you're ready.";
    const result: NlTurnResult = {
      proposal: null,
      validated: null,
      explanation: null,
      meta,
      reply,
    };
    return {
      conversation: appendTurn(appendTurn(fresh, "user", userText, now), "mova", reply, now),
      result,
    };
  }

  // --- Normal payment message ----------------------------------------------
  const proposal = extractStructuredProposal(userText, ctx);
  const { proposal: merged, inferred } = mergeWithWorking(conv.workingIntent, proposal, ctx);
  const validated = validateStructuredProposal(merged, ctx);
  const explanation = validated.proposal ? explainIntent(validated, validated.proposal, inferred) : null;
  const reply = buildReply({ validated, explanation, meta });

  const conversation: PaymentConversation = {
    ...conv,
    workingIntent: validated,
    confirmed: false,
    turns: [...conv.turns],
  };
  const withTurns = appendTurn(appendTurn(conversation, "user", userText, now), "mova", reply, now);

  return {
    conversation: withTurns,
    result: { proposal: merged, validated, explanation, meta, reply },
  };
}
