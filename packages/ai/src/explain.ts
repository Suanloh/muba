/**
 * Explanation generation (Phase 2).
 *
 * Turns a validated structured intent into a plain-language statement of what
 * MOVA understood — e.g. "I understand: send 200 USDC to Alice on Sui Testnet."
 * The user must read and confirm this BEFORE anything proceeds. The AI is
 * explaining its interpretation, never authorizing execution.
 */
import type {
  IntentExplanation,
  Money,
  Network,
  StructuredIntentProposal,
  ValidatedStructuredIntent,
} from "@mova/types";

const NETWORK_LABELS: Record<Network, string> = {
  SUI_DEVNET: "Sui Devnet",
  SUI_TESTNET: "Sui Testnet",
  SUI_MAINNET: "Sui Mainnet",
};

/** Human display of a canonical smallest-unit Money. */
export function formatCanonicalMoney(money: Money): string {
  const decimals: Record<string, number> = { SUI: 9, USDC: 6, MOV: 8 };
  const d = decimals[money.asset] ?? 6;
  const bn = BigInt(money.amount);
  const neg = bn < 0n;
  const abs = neg ? -bn : bn;
  const str = abs.toString().padStart(d + 1, "0");
  const whole = str.slice(0, -d) || "0";
  const frac = str.slice(-d).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""} ${money.asset}`;
}

function networkDisplay(network: Network): string {
  return NETWORK_LABELS[network] ?? network;
}

/**
 * Build the explanation for a validated intent. `inferredFields` lists which
 * fields were carried from conversation context (marked "inferred").
 */
export function explainIntent(
  validated: ValidatedStructuredIntent,
  proposal: StructuredIntentProposal,
  inferredFields: string[] = [],
): IntentExplanation {
  const source = (field: string): "parsed" | "inferred" | "missing" =>
    inferredFields.includes(field) ? "inferred" : "parsed";

  const amountValue = validated.canonicalAmount
    ? formatCanonicalMoney(validated.canonicalAmount)
    : proposal.amountRaw
      ? `${proposal.amountRaw} ${proposal.currencyInput || "?"}`
      : "not stated";
  const amountSource: "parsed" | "inferred" | "missing" =
    proposal.amountRaw === null ? "missing" : source("amount");

  const currencyValue = proposal.currencyInput || "not stated";
  const currencySource: "parsed" | "inferred" | "missing" =
    proposal.currencyInput === "" ? "missing" : source("currency");

  const recipientValue = proposal.recipient.value
    ? proposal.recipient.name ?? proposal.recipient.value
    : "not stated";
  const recipientSource: "parsed" | "inferred" | "missing" =
    proposal.recipient.value === "" ? "missing" : source("recipient");

  const networkValue = networkDisplay(proposal.network);
  const networkSource: "parsed" | "inferred" | "missing" =
    proposal.networkMentioned === "none" ? "inferred" : "parsed";

  const purposeValue = proposal.purpose ?? "—";
  const timingValue = proposal.timingLabel ?? (proposal.scheduleAt ? "scheduled" : "immediately");
  const constraintsValue =
    proposal.constraints.length > 0 ? proposal.constraints.map((c) => c.label).join(", ") : "—";
  const methodValue =
    proposal.paymentMethod === null
      ? "wallet balance (default)"
      : proposal.paymentMethod === "UNKNOWN"
        ? "not supported on Sui"
        : proposal.paymentMethod.replace("_", " ").toLowerCase();

  const summary =
    `I understand: ${proposal.action === "PAY" ? "pay" : "send"} ${amountValue} ` +
    `to ${recipientValue} on ${networkDisplay(proposal.network)}.`;

  const notes: string[] = [];
  for (const w of proposal.warnings) notes.push(w);
  for (const issue of validated.warnings) {
    if (!notes.includes(issue.message)) notes.push(issue.message);
  }
  if (proposal.paymentMethod === "UNKNOWN") {
    notes.push("The payment method you mentioned isn't available on Sui — it will use your wallet balance.");
  }
  if (validated.needsClarification) {
    notes.push(validated.clarificationQuestion ?? "I need a little more detail before I can confirm.");
  }

  return {
    summary,
    details: [
      { label: "Action", value: proposal.action, source: "parsed" },
      { label: "Amount", value: amountValue, source: amountSource },
      { label: "Currency", value: currencyValue, source: currencySource },
      { label: "Recipient", value: recipientValue, source: recipientSource },
      { label: "Network", value: networkValue, source: networkSource },
      { label: "Purpose", value: purposeValue, source: purposeValue === "—" ? "missing" : "parsed" },
      { label: "Timing", value: timingValue, source: timingValue === "immediately" ? "inferred" : "parsed" },
      { label: "Constraints", value: constraintsValue, source: constraintsValue === "—" ? "missing" : "parsed" },
      { label: "Payment method", value: methodValue, source: methodValue.includes("default") ? "inferred" : "parsed" },
    ],
    notes,
  };
}
