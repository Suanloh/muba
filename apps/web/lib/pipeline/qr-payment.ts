/**
 * QR payment orchestration (Phase 3).
 *
 * Bridges the local EMVCo decoder (`@mova/qr`) to the SAME deterministic
 * payment pipe the NL chat uses:
 *
 *   QR payload → decodeEmvco (local, no API) → validateQrDecoded (@mova/qr,
 *   reuses @mova/core validator) → USER picks Sui token → buildPipelineText
 *   → createFlow (common pipe)
 *
 * QR amounts are fiat (EMVCo is fiat-only). The user picks a Sui token
 * (USDC/SUI/MOV) before confirming — exactly the "conversion required" gate
 * the NL path enforces for spoken fiat amounts. Nothing here executes,
 * approves, or bypasses compliance: confirmation is a human gate, and the
 * decoded QR (like the NL parse) is validated deterministically first.
 */
import {
  decodeEmvco,
  validateQrDecoded,
  type QrValidationResult,
} from "@mova/qr";
import type {
  IntentParserContext,
  Network,
  QrDecoded,
  SupportedToken,
} from "@mova/types";
import { currencyLabel } from "@mova/qr";

/** Tokens the user can settle a fiat QR amount into on Sui. */
export const QR_TOKEN_OPTIONS: readonly SupportedToken[] = ["USDC", "SUI", "MOV"];

/** Build the parser context for a wallet-connected QR session. */
export function qrParserContext(opts: {
  userId: string;
  walletId: string;
  network: Network;
}): IntentParserContext {
  return {
    userId: opts.userId,
    walletId: opts.walletId,
    network: opts.network,
  };
}

/**
 * Decode + deterministically validate a scanned/pasted QR payload.
 * Pure local decode — no network, no LLM, no third-party QR API.
 */
export function decodeQrPayload(
  payload: string,
  ctx: IntentParserContext,
): QrValidationResult {
  const decoded: QrDecoded = decodeEmvco(payload);
  return validateQrDecoded(decoded, ctx);
}

/** A decoded QR is confirmable once validation passes + an amount was scanned. */
export function canConfirmQrIntent(validated: QrValidationResult | null): boolean {
  return (
    !!validated &&
    validated.ok &&
    !validated.needsClarification &&
    validated.proposal?.amountRaw !== null &&
    validated.qrErrors.length === 0
  );
}

/**
 * Convert a validated QR intent into the raw-text form the existing demo
 * pipeline (`createFlow` → `parseDemoIntent`) understands. The merchant handle
 * becomes an `@handle` recipient and the fiat amount is expressed in the
 * user-chosen Sui token.
 */
export function buildQrPipelineText(
  validated: QrValidationResult,
  token: SupportedToken,
): string | null {
  if (!validated.ok || !validated.proposal) return null;
  const p = validated.proposal;
  if (p.amountRaw === null) return null;
  const recipientValue = p.recipient.value.startsWith("@")
    ? p.recipient.value
    : `@${p.recipient.value}`;
  const purpose = p.purpose ? ` for ${p.purpose}` : "";
  return `Pay ${p.amountRaw} ${token} to ${recipientValue}${purpose}`;
}

/** Short human summary of a decoded QR (for notifications/toasts). */
export function qrIntentSummary(validated: QrValidationResult): string {
  const p = validated.proposal;
  if (!p) return "QR payment";
  const who = p.recipient.name ?? p.recipient.value;
  const currency = validated.decoded.currencyCode
    ? currencyLabel(validated.decoded.currencyCode).split(" ")[0]
    : "?";
  return `${p.amountRaw ?? "?"} ${currency} to ${who}`;
}
