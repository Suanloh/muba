/**
 * QR → normalized MOVA payment intent (Phase 3).
 *
 * Both input channels converge on the SAME normalized intent shape:
 *
 *   Natural Language → StructuredIntentProposal (@mova/ai)  ─┐
 *   QR payload        → StructuredIntentProposal (@mova/qr)  ─┼→ validateStructuredProposal (@mova/core) → payment pipe
 *
 * The QR decoder (`@mova/qr`) is deterministic and local: no network, no LLM.
 * The decoded amount/merchant are trusted structured inputs — the AI may
 * assist interpretation but never overwrites them. Every money figure is
 * re-computed by the deterministic validator before it is presented or
 * settled, exactly like the NL path.
 *
 * Fail-closed: a QR whose CRC-16/CCITT does not verify is treated as tampered
 * and can never be confirmed, regardless of how plausible the fields look.
 */
import { validateStructuredProposal, type ValidateProposalResult } from "@mova/core";
import type {
  IntentParserContext,
  QrDecoded,
  RecipientRef,
  StructuredIntentProposal,
  ValidationIssue,
} from "@mova/types";
import { currencyFromIso4217Numeric, currencyLabel } from "./currency.js";
import { parseTlv } from "./tlv.js";

// ---------------------------------------------------------------------------
// Merchant identifier (the QR "recipient")
// ---------------------------------------------------------------------------

/**
 * EMVCo merchant account information (fields 02–05 / 26–51) is frequently a
 * nested TLV. When it parses cleanly we prefer a meaningful sub-identifier
 * (account/token fields 02–04, else the longest sub-value) over the raw
 * container string, so the resulting handle is stable and human-meaningful.
 */
export function extractMerchantIdentifier(d: QrDecoded): {
  value: string;
  name: string | null;
} {
  if (d.merchantAccount) {
    const sub = parseTlv(d.merchantAccount);
    if (sub.errors.length === 0 && sub.fields.length > 0) {
      const preferred = ["02", "03", "04"]
        .map((t) => sub.fields.find((f) => f.tag === t)?.value)
        .find((v): v is string => Boolean(v));
      const chosen =
        preferred ??
        [...sub.fields].sort((a, b) => b.value.length - a.value.length)[0]?.value;
      if (chosen) return { value: chosen, name: d.merchantName };
    }
    return { value: d.merchantAccount, name: d.merchantName };
  }
  const fallback = d.reference ?? d.billNumber ?? d.merchantName ?? d.merchantCity;
  return { value: fallback ?? "", name: d.merchantName };
}

// ---------------------------------------------------------------------------
// QR → StructuredIntentProposal (deterministic, no LLM)
// ---------------------------------------------------------------------------

/**
 * Convert a locally-decoded EMVCo payload into the SAME `StructuredIntentProposal`
 * shape the NL pipe produces, so both channels share one validator + pipeline.
 *
 * Recipient: EMVCo identifies a MERCHANT, not a Sui address. MOVA models the
 * merchant as a `HANDLE` recipient (named from field 59). A QR fiat amount is
 * deliberately left as fiat — the validator raises the same "conversion
 * required" warning as a spoken fiat amount, and the user must pick a Sui
 * token before confirming.
 */
export function qrToStructuredProposal(
  decoded: QrDecoded,
  ctx: IntentParserContext,
): StructuredIntentProposal {
  const warnings: string[] = [];

  // Non-fatal decode issues are surfaced as warnings (CRC failure is fatal and
  // handled separately — see `validateQrDecoded`).
  for (const err of decoded.parseErrors) {
    if (!err.toLowerCase().includes("crc")) warnings.push(`QR decode note: ${err}`);
  }

  const currencyInput = currencyFromIso4217Numeric(decoded.currencyCode) ?? decoded.currencyCode ?? "";
  if (decoded.currencyCode && currencyFromIso4217Numeric(decoded.currencyCode) === null) {
    warnings.push(
      `Unrecognized currency code "${decoded.currencyCode}" — no settlement currency can be derived from this QR.`,
    );
  }

  const merchant = extractMerchantIdentifier(decoded);
  const recipient: RecipientRef = {
    type: "HANDLE",
    value: merchant.value,
    name: merchant.name ?? null,
    ambiguous: false,
  };
  if (!merchant.value) {
    warnings.push("No merchant identifier found in the QR — you will need to specify who receives this payment.");
  }

  const rawText = summarizeQr(decoded);

  return {
    action: "PAY",
    amountRaw: decoded.amountRaw,
    currencyInput,
    recipient,
    network: ctx.network,
    networkMentioned: "none",
    conflicts: [],
    purpose: decoded.reference ?? decoded.billNumber ?? null,
    scheduleAt: null,
    timingLabel: null,
    constraints: [],
    paymentMethod: null,
    confidence: 1, // deterministic decode — not an LLM guess
    needsClarification: false,
    clarificationQuestion: null,
    warnings,
    rawText,
    rawLlmOutput: null,
  };
}

/** One-line human summary of a decoded QR payment (audit + UX). */
export function summarizeQr(d: QrDecoded): string {
  const who = d.merchantName ?? extractMerchantIdentifier(d).value ?? "unknown merchant";
  const currency = currencyFromIso4217Numeric(d.currencyCode);
  const amount = d.amountRaw
    ? `${d.amountRaw} ${currency ? currencyLabel(currency).split(" ")[0] : (d.currencyCode ?? "?")}`
    : "no amount stated";
  return `Pay ${amount} to ${who}`;
}

// ---------------------------------------------------------------------------
// Validation (authority over the decoded QR)
// ---------------------------------------------------------------------------

/** Validator output for a decoded QR — the QR channel's authority. */
export interface QrValidationResult extends ValidateProposalResult {
  decoded: QrDecoded;
  source: "EMVCO";
  /** QR-integrity blocking errors (e.g. CRC mismatch / tampered payload). */
  qrErrors: string[];
  /** One-line human summary of the scanned payment. */
  summary: string;
  /** True when the QR stated a fiat amount that needs token conversion. */
  needsTokenConversion: boolean;
}

/**
 * Deterministically validate a decoded QR payload. Runs the decoded fields
 * through the SAME `validateStructuredProposal` used by the NL pipe and layers
 * QR-integrity rules on top:
 *
 *   - CRC-16/CCITT must verify (fail-closed on tampered payloads)
 *   - fiat amounts require a token conversion (warning, not an error)
 *   - a merchant handle is a valid `HANDLE` recipient (never treated as a
 *     Sui address)
 *
 * `ok: true` still requires explicit human confirmation before the payment
 * pipeline may run — same gate as the NL path.
 */
export function validateQrDecoded(
  decoded: QrDecoded,
  ctx: IntentParserContext,
): QrValidationResult {
  const qrErrors: string[] = [];
  if (!decoded.crcValid) {
    qrErrors.push(
      "QR integrity check failed (CRC mismatch) — the payload may be tampered or truncated. Payment blocked.",
    );
  }
  if (decoded.payloadFormat !== null && decoded.payloadFormat !== "01") {
    qrErrors.push(
      `Unsupported EMVCo payload format "${decoded.payloadFormat}" — only format indicator 01 is accepted.`,
    );
  }

  const proposal = qrToStructuredProposal(decoded, ctx);
  const base = validateStructuredProposal(proposal, ctx);

  // Fuse QR-integrity verdict into the standard validation.
  const issues: ValidationIssue[] = [
    ...qrErrors.map((message) => ({
      code: "UNKNOWN" as const,
      severity: "ERROR" as const,
      field: "qrIntegrity",
      message,
    })),
    ...base.issues,
  ];
  const errors = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");

  const needsTokenConversion = proposal.amountRaw !== null && base.canonicalAmount === null;

  return {
    ...base,
    ok: base.ok && qrErrors.length === 0,
    issues,
    errors,
    warnings,
    decoded,
    source: "EMVCO",
    qrErrors,
    summary: summarizeQr(decoded),
    needsTokenConversion,
  };
}

/**
 * A decoded QR is confirmable when QR-integrity + standard validation pass and
 * an amount was actually scanned. QR amounts are fiat — the user still picks a
 * Sui token (USDC/SUI/MOV) in the UI before the intent enters the payment
 * pipe, so no `canonicalAmount` is required here.
 */
export function canConfirmQr(validated: QrValidationResult): boolean {
  return (
    validated.ok &&
    !validated.needsClarification &&
    validated.proposal !== null &&
    validated.proposal.amountRaw !== null &&
    validated.qrErrors.length === 0
  );
}
