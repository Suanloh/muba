/**
 * Deterministic natural-language → structured intent extractor (Phase 2).
 *
 * Turns free text into a `StructuredIntentProposal` (a SUGGESTION). It fills
 * slots deterministically — amount, currency, recipient, network, purpose,
 * timing, constraints, payment method — using the shared registry from
 * `@mova/types` so the deterministic validator can never disagree with it.
 *
 * This is a parser and assistant. It never produces executable transaction
 * instructions, never calls a chain, and never approves anything. Where the
 * input is ambiguous it marks `needsClarification` and asks, instead of
 * guessing.
 */
import {
  canonicalCurrency,
  networkFromAlias,
  type IntentParserContext,
  type IntentAction,
  type Network,
  type PaymentMethod,
  type RecipientRef,
  type StructuredIntentProposal,
  type UserConstraint,
} from "@mova/types";

// ---------------------------------------------------------------------------
// Amount detection
// ---------------------------------------------------------------------------

interface AmountCandidate {
  amount: string; // normalized decimal ("200", "100.50")
  currencyInput: string; // as typed ("USDC", "RM", "$", "")
  start: number;
  end: number;
}

const NUMBER_RE = /\d{1,12}(?:[.,]\d{1,18})?/;
/** "200 USDC" / "100 RM" / "10 SUI" / "5 USDC" */
const AMOUNT_TOKEN_RE = new RegExp(`\\b(${NUMBER_RE.source})\\s*([A-Za-z]{2,10})\\b`, "gi");
/** "USDC 200" / "SUI 10" (currency word first). */
const CURRENCY_FIRST_RE = new RegExp(`\\b([A-Za-z]{2,10})\\s*(${NUMBER_RE.source})\\b`, "gi");
/** "$200" / "RM100" / "€50" */
const SYMBOL_AMOUNT_RE = /([$€£¥]|RM)\s*(\d{1,12}(?:[.,]\d{1,18})?)/gi;
/** Bare number (no currency attached). */
const BARE_AMOUNT_RE = /\b\d{1,12}(?:[.,]\d{1,18})?\b/g;

/** All currency words mentioned anywhere in the text ("dollars", "USDC"). */
const CURRENCY_WORD_RE = /\b([A-Za-z$€£¥]{2,10})\b/g;

/** True when a match at `index` sits inside a constraint clause ("max fee 1 SUI"). */
function isConstraintContext(text: string, index: number): boolean {
  const tail = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return /(?:max|maximum|cap|capped|under|below|at most|limit|fee|fees|gas|don'?t|do not|spend|budget|less than|no more than)\s*[^a-z0-9]*$/i.test(
    tail,
  );
}

function collectAmountCandidates(text: string): AmountCandidate[] {
  const candidates: AmountCandidate[] = [];
  const push = (amount: string, currencyInput: string, start: number, end: number) => {
    if (isConstraintContext(text, start)) return; // fee caps / spend caps are not the payment amount
    candidates.push({ amount, currencyInput, start, end });
  };

  for (const m of text.matchAll(AMOUNT_TOKEN_RE)) {
    const cur = m[2] ?? "";
    if (canonicalCurrency(cur) === "UNKNOWN") continue; // "Pay to Alice" style word, not a currency
    push(m[1]?.replace(",", "") ?? "", cur, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }

  for (const m of text.matchAll(CURRENCY_FIRST_RE)) {
    const cur = m[1] ?? "";
    if (canonicalCurrency(cur) === "UNKNOWN") continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (candidates.some((c) => start < c.end && end > c.start)) continue;
    push(m[2]?.replace(",", "") ?? "", cur, start, end);
  }

  for (const m of text.matchAll(SYMBOL_AMOUNT_RE)) {
    push(m[2]?.replace(",", "") ?? "", m[1] ?? "", m.index ?? 0, (m.index ?? 0) + m[0].length);
  }

  // Bare numbers not overlapping any existing candidate.
  for (const m of text.matchAll(BARE_AMOUNT_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (candidates.some((c) => start < c.end && end > c.start)) continue;
    push(m[0].replace(",", ""), "", start, end);
  }

  return candidates;
}

/**
 * When no amount is bound to a currency, detect a lone currency mention
 * ("in USDC" as a follow-up). Only fires when there is no amount at all, so
 * constraint mentions ("max fee 1 SUI") are never mistaken for the currency.
 */
function detectCurrencyOnly(text: string, hasAmountCandidate: boolean): string {
  if (hasAmountCandidate) return "";
  const found = new Set<string>();
  const typed: string[] = [];
  const note = (w: string) => {
    const cur = canonicalCurrency(w);
    if (cur !== "UNKNOWN" && !found.has(cur)) {
      found.add(cur);
      typed.push(w);
    }
  };
  for (const m of text.matchAll(CURRENCY_WORD_RE)) note(m[1] ?? "");
  for (const sym of ["$", "€", "£", "¥", "RM"]) if (text.includes(sym)) note(sym);
  return found.size === 1 ? (typed[0] ?? "") : "";
}

/** Choose the canonical (amount, currency) from candidates; detect conflicts. */
function resolveAmount(
  candidates: AmountCandidate[],
  warnings: string[],
  conflicts: string[],
): { amountRaw: string | null; currencyInput: string } {
  if (candidates.length === 0) {
    return { amountRaw: null, currencyInput: "" };
  }

  // Prefer a token (SUI/USDC/MOV) currency over fiat when several attach to
  // the same numeric value ("$200 USDC" → 200 USDC).
  const byAmount = new Map<string, AmountCandidate[]>();
  for (const c of candidates) {
    const list = byAmount.get(c.amount) ?? [];
    list.push(c);
    byAmount.set(c.amount, list);
  }

  const distinctAmounts = [...byAmount.keys()];
  if (distinctAmounts.length > 1) {
    conflicts.push(`two different amounts (${distinctAmounts.slice(0, 3).join(", ")})`);
  }

  const chosen = distinctAmounts[0] ?? null;
  if (chosen === null) return { amountRaw: null, currencyInput: "" };

  const group = byAmount.get(chosen) ?? [];
  const token = group.find((c) => {
    const cur = canonicalCurrency(c.currencyInput);
    return cur === "SUI" || cur === "USDC" || cur === "MOV";
  });
  const best = token ?? group[0] ?? null;
  if (!best) return { amountRaw: null, currencyInput: "" };

  // Mixed currencies are only a conflict when no token is present — "$200 USDC"
  // is symbol + token (one currency), whereas "200 USD and 300 USDC" is not.
  const currencies = new Set(
    group
      .map((c) => canonicalCurrency(c.currencyInput))
      .filter((c) => c !== "UNKNOWN"),
  );
  if (currencies.size > 1 && !token) {
    conflicts.push(`mixed currencies (${[...currencies].join(" and ")})`);
    warnings.push("Several currencies were mentioned — I'll ask which one to use.");
  }

  return { amountRaw: best.amount, currencyInput: best.currencyInput };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

function extractAction(text: string): IntentAction {
  if (/^(pay|charge|bill|settle)\b/i.test(text)) return "PAY";
  if (/^(send|transfer|remit|wire)\b/i.test(text)) return "TRANSFER";
  return "PAY";
}

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

const ADDRESS_RE = /\b0x[0-9a-fA-F]{1,64}\b/;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const HANDLE_RE = /@([\w.-]{2,64})/;
const NAME_RE = /\b([A-Z][a-z]{1,20}(?:[ -][A-Z][a-z]{1,20}){0,2})\b/;
const GENERIC_RE =
  /\b(?:to|for|pay|send)\s+(this|that|the|my|their)\s+(merchant|wallet|vendor|store|shop|company|account)\b|\b(?:them|everyone|all)\b/i;

function extractRecipient(
  text: string,
  ctx: IntentParserContext,
): { recipient: RecipientRef; needsClarification: boolean; clarificationQuestion: string | null } {
  // 1. Explicit Sui address.
  const addr = text.match(ADDRESS_RE);
  if (addr) {
    return {
      recipient: { type: "ADDRESS", value: addr[0].toLowerCase(), name: null },
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  // 2. Email.
  const email = text.match(EMAIL_RE);
  if (email) {
    return {
      recipient: { type: "EMAIL", value: email[0].toLowerCase(), name: null },
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  // 3. @handle.
  const handle = text.match(HANDLE_RE);
  if (handle) {
    const raw = handle[0]; // "@treasury"
    const resolved = ctx.resolveRecipient?.(raw.slice(1).toLowerCase());
    if (resolved) {
      return {
        recipient: { ...resolved, name: resolved.name ?? raw.slice(1), resolved: true },
        needsClarification: false,
        clarificationQuestion: null,
      };
    }
    return {
      recipient: { type: "HANDLE", value: raw, name: raw.slice(1), resolved: false },
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  // 4. Generic phrase — ambiguous on purpose ("this merchant", "this wallet").
  const generic = text.match(GENERIC_RE);
  if (generic) {
    const phrase = generic[0].replace(/^(?:to|for|pay|send)\s+/i, "").trim();
    return {
      recipient: {
        type: "HANDLE",
        value: `@${phrase.toLowerCase().replace(/\s+/g, "-")}`,
        name: phrase,
        ambiguous: true,
      },
      needsClarification: true,
      clarificationQuestion:
        "Which recipient did you mean? Paste the exact Sui address (0x…), email, or @handle.",
    };
  }

  // 5. Bare capitalized name — resolve via the contact book, else ambiguous.
  //    Strip the leading action verb (any case) so "Send" isn't read as a name.
  const body = text.replace(/^(pay|send|transfer|charge|bill|settle|remit|wire|paying)\b/i, "").trim();
  const name = body.match(NAME_RE);
  if (name) {
    const candidate = name[1] ?? "";
    const resolved = ctx.resolveRecipient?.(candidate.toLowerCase());
    if (resolved) {
      return {
        recipient: { ...resolved, name: candidate, resolved: true },
        needsClarification: false,
        clarificationQuestion: null,
      };
    }
    return {
      recipient: { type: "HANDLE", value: `@${candidate.toLowerCase()}`, name: candidate, ambiguous: true },
      needsClarification: true,
      clarificationQuestion: `I don't know "${candidate}" — is that a saved contact? Paste the exact Sui address (0x…), email, or @handle.`,
    };
  }

  // 6. Nothing found.
  return {
    recipient: { type: "ADDRESS", value: "", name: null },
    needsClarification: true,
    clarificationQuestion: "Who should receive the payment? Paste a Sui address (0x…), email, or @handle.",
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function extractNetwork(text: string, expected: Network): {
  network: Network;
  networkMentioned: "none" | "supported" | "unsupported";
} {
  const joined = text.toLowerCase();
  // Unsupported chains take precedence (fail-closed): MOVA is Sui-only.
  for (const w of joined.split(/\s+/)) {
    if (networkFromAlias(w) === "UNSUPPORTED") {
      return { network: expected, networkMentioned: "unsupported" };
    }
  }
  // Explicit network names (check the full text so "on Sui Mainnet" wins).
  if (/\bmainnet\b/.test(joined)) return { network: "SUI_MAINNET", networkMentioned: "supported" };
  if (/\bdevnet\b/.test(joined)) return { network: "SUI_DEVNET", networkMentioned: "supported" };
  if (/\btestnet\b/.test(joined)) return { network: "SUI_TESTNET", networkMentioned: "supported" };
  // Bare "Sui" → the expected runtime network.
  if (/\bsui\b/.test(joined)) return { network: expected, networkMentioned: "supported" };
  return { network: expected, networkMentioned: "none" };
}

// ---------------------------------------------------------------------------
// Purpose / memo
// ---------------------------------------------------------------------------

function extractPurpose(text: string, recipient: RecipientRef): string | null {
  const m =
    text.match(/\b(?:for|memo|note|purpose|re:)\s*:?\s*["']?([^"',.!?;]{2,60})["']?/i) ??
    text.match(/\b(?:paying|regarding)\s+["']?([^"',.!?;]{2,60})["']?/i);
  if (!m) return null;
  let phrase = (m[1] ?? "").trim();
  phrase = phrase.replace(/[.!?\s]+$/, "");
  // A purpose that is exactly the recipient's name is not a purpose.
  const nameKey = (recipient.name ?? recipient.value).toLowerCase();
  if (phrase.toLowerCase() === nameKey) return null;
  if (phrase.length < 2) return null;
  return phrase;
}

// ---------------------------------------------------------------------------
// Shared helpers (reused by the LLM adapter)
// ---------------------------------------------------------------------------

/** Map a free-form payment-method string to a PaymentMethod (null = none). */
export function paymentMethodFromString(s: string | null | undefined): PaymentMethod | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/(wallet|balance|direct|account)/.test(t)) return "WALLET_BALANCE";
  if (/\bbatch\b/.test(t)) return "BATCH";
  if (/(card|paypal|venmo|bank|wire|cash|apple|google|unknown|unsupported)/.test(t)) return "UNKNOWN";
  return null;
}

/** Map a free-form constraint string to a UserConstraint (null = unparsable). */
export function constraintFromRaw(raw: string): UserConstraint | null {
  const t = raw.trim();
  if (t === "") return null;
  const lower = t.toLowerCase();
  if (/(?:max|under|below|at most|cap)\s*(?:fee|fees|gas)|fee|gas/i.test(lower)) {
    return { kind: "FEE_CAP", label: `Max fee ${t}`, raw: t };
  }
  if (/(?:don'?t|do not|no more than|at most|cap)\s*spend|spend\s*(?:at most|cap)/i.test(lower)) {
    return { kind: "SPEND_CAP", label: `Spend at most ${t}`, raw: t };
  }
  if (/(urgent|asap|priority|rush|fastest)/i.test(lower)) {
    return { kind: "SPEED", label: "Priority / urgent", raw: t };
  }
  if (/(by|before|on|tomorrow|until|deadline)/i.test(lower)) {
    return { kind: "TIMING", label: `Timing: ${t}`, raw: t };
  }
  return { kind: "OTHER", label: t, raw: t };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

function nextWeekday(day: number, now: Date): Date {
  const d = new Date(now);
  let diff = (day - d.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  d.setHours(9, 0, 0, 0);
  return d;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function extractTiming(text: string, now: number): {
  scheduleAt: string | null;
  timingLabel: string | null;
} {
  const lower = text.toLowerCase();

  if (/\b(now|immediately|right away|asap|asap!)\b/.test(lower)) {
    return { scheduleAt: new Date(now).toISOString(), timingLabel: "immediately" };
  }

  const tomorrow = lower.match(/\btomorrow\b/);
  if (tomorrow) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { scheduleAt: d.toISOString(), timingLabel: "tomorrow" };
  }

  const by = lower.match(/\bby\s+(?:this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/);
  if (by) {
    const day = WEEKDAYS[by[1] ?? ""];
    if (day !== undefined) {
      const d = nextWeekday(day, new Date(now));
      return { scheduleAt: d.toISOString(), timingLabel: `by ${by[1]}` };
    }
  }

  const on = lower.match(/\bon\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/);
  if (on) {
    const month = on[1]?.slice(0, 3) ?? "jan";
    const day = Number(on[2]);
    const d = new Date(now);
    d.setMonth(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month), day);
    d.setHours(9, 0, 0, 0);
    return { scheduleAt: d.toISOString(), timingLabel: `on ${on[1]} ${on[2]}` };
  }

  const inN = lower.match(/\bin\s+(\d{1,3})\s*(hours?|days?|weeks?)\b/);
  if (inN) {
    const n = Number(inN[1]);
    const unit = inN[2] ?? "days";
    const ms = unit.startsWith("hour") ? n * 3600_000 : unit.startsWith("week") ? n * 7 * 86_400_000 : n * 86_400_000;
    return { scheduleAt: new Date(now + ms).toISOString(), timingLabel: `in ${n} ${unit}` };
  }

  return { scheduleAt: null, timingLabel: null };
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

function extractConstraints(text: string): UserConstraint[] {
  const constraints: UserConstraint[] = [];
  const lower = text.toLowerCase();

  // Fee cap: "max fee 1 SUI", "fees under 0.5 SUI", "gas at most 0.1 SUI"
  const fee = text.match(
    /\b(?:max|maximum|under|below|at most|cap)\s+(?:fee|fees|gas)\s*(?:of|at|to|under)?\s*([$€£¥RM]?\d+(?:[.,]\d+)?\s*(?:SUI|USDC|MOV|USD|MYR)?)/i,
  );
  if (fee) {
    constraints.push({ kind: "FEE_CAP", label: `Max fee ${fee[1]?.trim()}`, raw: fee[0].trim() });
  } else {
    const fee2 = text.match(
      /\b(?:fee|fees|gas)\s+(?:under|below|at most|of)\s+([$€£¥RM]?\d+(?:[.,]\d+)?\s*(?:SUI|USDC|MOV|USD|MYR)?)/i,
    );
    if (fee2) {
      constraints.push({ kind: "FEE_CAP", label: `Max fee ${fee2[1]?.trim()}`, raw: fee2[0].trim() });
    }
  }

  // Spend cap: "don't spend more than 300", "cap at 300"
  const spend = text.match(
    /\b(?:don'?t|do not)\s+spend\s+more\s+than\s+([$€£¥RM]?\d+(?:[.,]\d+)?\s*(?:SUI|USDC|MOV|USD|MYR)?)/i,
  );
  if (spend) {
    constraints.push({ kind: "SPEND_CAP", label: `Spend at most ${spend[1]?.trim()}`, raw: spend[0].trim() });
  }

  // Speed: urgent / priority / fastest
  if (/\b(?:urgent|priority|fastest|rush)\b/i.test(lower)) {
    constraints.push({ kind: "SPEED", label: "Priority / urgent", raw: "urgent" });
  }

  return constraints;
}

// ---------------------------------------------------------------------------
// Payment method
// ---------------------------------------------------------------------------

function extractPaymentMethod(text: string): PaymentMethod | null {
  if (/\b(?:from|use|using)\s+my\s+wallet\b|\bwallet\s+balance\b/i.test(text)) {
    return "WALLET_BALANCE";
  }
  if (/\bbatch\b/i.test(text)) {
    return "BATCH";
  }
  if (
    /\b(?:credit\s*card|debit\s*card|paypal|venmo|bank\s*transfer|wire\s*transfer|cash|apple\s*pay|google\s*pay)\b/i.test(
      text,
    )
  ) {
    return "UNKNOWN"; // recognized but not settleable on Sui → validator warns
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/** Parse one natural-language payment message into a structured proposal. */
export function extractStructuredProposal(
  rawText: string,
  ctx: IntentParserContext,
): StructuredIntentProposal {
  const text = rawText.trim();
  const warnings: string[] = [];
  const conflicts: string[] = [];

  const action = extractAction(text);
  const candidates = collectAmountCandidates(text);
  const { amountRaw, currencyInput } = resolveAmount(candidates, warnings, conflicts);
  // Follow-ups that only name a currency ("in USDC") — never guess when an
  // amount exists without a currency.
  const currencyInputFinal =
    currencyInput !== "" ? currencyInput : detectCurrencyOnly(text, amountRaw !== null);

  const { recipient, needsClarification, clarificationQuestion } = extractRecipient(text, ctx);
  const { network, networkMentioned } = extractNetwork(text, ctx.network);
  const purpose = extractPurpose(text, recipient);
  const { scheduleAt, timingLabel } = extractTiming(text, ctx.now ?? Date.now());
  const constraints = extractConstraints(text);
  const paymentMethod = extractPaymentMethod(text);

  // Amount present but no currency at all → ask (don't guess a token).
  let needsCurrency = false;
  if (amountRaw !== null && currencyInputFinal === "" && recipient.value !== "") {
    needsCurrency = true;
  }

  return {
    action,
    amountRaw,
    currencyInput: currencyInputFinal,
    recipient,
    network,
    networkMentioned,
    conflicts,
    purpose,
    scheduleAt,
    timingLabel,
    constraints,
    paymentMethod,
    confidence: Math.max(0, 0.95 - conflicts.length * 0.2),
    needsClarification: needsClarification || needsCurrency,
    clarificationQuestion:
      clarificationQuestion ??
      (needsCurrency ? "Which currency should I use — SUI, USDC or MOV?" : null),
    warnings,
    rawText: text,
    rawLlmOutput: null,
  };
}

// Re-export for consumers that want just the currency-word list.
export { CURRENCY_WORD_RE };
