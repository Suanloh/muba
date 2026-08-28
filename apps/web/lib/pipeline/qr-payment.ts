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
import { demoAddress, resolveDemoRecipient } from "./demo-contacts";

/** Tokens the user can settle a fiat QR amount into on Sui. */
export const QR_TOKEN_OPTIONS: readonly SupportedToken[] = ["USDC", "SUI", "MOV"];

/**
 * Resolve a QR merchant handle to a Sui address. EMVCo identifies a merchant,
 * not a chain address — this is the demo handle registry (the same contract as
 * the NL contact book): a known contact resolves to its address, anything else
 * maps to a stable, deterministic demo address derived from the merchant id
 * (stand-in for a real handle/address service). A valid address is REQUIRED
 * before the shared payment pipe can build a transaction spec.
 */
export function merchantHandleToAddress(handle: string): string {
  const name = handle.replace(/^@/, "");
  const contact = resolveDemoRecipient(name);
  if (contact && contact.type === "ADDRESS") return contact.value;
  // Deterministic demo stand-in: hash the merchant id to a hex prefix so any
  // merchant maps to a stable, valid 64-hex Sui address for the demo pipe.
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return demoAddress((h >>> 0).toString(16).padStart(8, "0"));
}

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
  // Resolve the EMVCo merchant to a Sui address so the shared pipe can settle.
  const recipientValue = merchantHandleToAddress(p.recipient.value);
  const purpose = p.purpose ? ` for ${p.purpose}` : "";
  return `Pay ${p.amountRaw} ${token} to ${recipientValue}${purpose}`;
}

