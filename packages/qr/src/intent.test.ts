/**
 * QR package tests — local EMVCo decode → normalized intent → validation.
 *
 * Verifies the Phase 3 QR channel converges on the SAME normalized
 * `StructuredIntentProposal` + deterministic validation the NL pipe uses,
 * including the fail-closed CRC rule and fiat-token-conversion behavior.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IntentParserContext } from "@mova/types";
import { crc16Ccitt, stringToUtf8 } from "./crc.js";
import { decodeEmvco } from "./decode.js";
import {
  canConfirmQr,
  extractMerchantIdentifier,
  qrToStructuredProposal,
  summarizeQr,
  validateQrDecoded,
} from "./intent.js";
import { currencyFromIso4217Numeric, iso4217NumericForCurrency } from "./currency.js";

// ---------------------------------------------------------------------------
// EMVCo payload builder (computes the CRC-16/CCITT for a valid payload)
// ---------------------------------------------------------------------------

function field(tag: string, value: string): string {
  const len = String(value.length).padStart(2, "0");
  return `${tag}${len}${value}`;
}

/** Build an EMVCo payload with a valid CRC field (63). */
function payload(fields: Array<[string, string]>): string {
  const body = fields.map(([t, v]) => field(t, v)).join("");
  const crc = crc16Ccitt(stringToUtf8(body)).toString(16).toUpperCase().padStart(4, "0");
  return `${body}6304${crc}`;
}

const ctx: IntentParserContext = {
  userId: "u1",
  walletId: "w1",
  network: "SUI_TESTNET",
};

/** MYR 10.00 merchant-presented payload (MOVA test merchant). */
const MYR_PAYLOAD = payload([
  ["00", "01"],
  ["01", "12"],
  ["02", "M0001"],
  ["52", "5411"],
  ["53", "458"],
  ["54", "10.00"],
  ["58", "MY"],
  ["59", "MOVA TEST MERCHANT"],
  ["60", "KL"],
]);

/** USD 200.00 payload with a nested merchant-account TLV (tag 26). */
const USD_PAYLOAD = payload([
  ["00", "01"],
  ["01", "12"],
  ["26", "0111ACME-WALLET0208ACME0001"],
  ["53", "840"],
  ["54", "200.00"],
  ["58", "US"],
  ["59", "ACME CORP"],
]);

// ---------------------------------------------------------------------------
// Currency mapping
// ---------------------------------------------------------------------------

test("currency: ISO 4217 numeric → MOVA fiat symbols", () => {
  assert.equal(currencyFromIso4217Numeric("458"), "MYR");
  assert.equal(currencyFromIso4217Numeric("840"), "USD");
  assert.equal(currencyFromIso4217Numeric("978"), "EUR");
  assert.equal(currencyFromIso4217Numeric("999"), null); // unknown
  assert.equal(currencyFromIso4217Numeric(null), null);
  assert.equal(iso4217NumericForCurrency("MYR"), "458");
});

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

test("decode: valid MYR payload verifies CRC and extracts fields", () => {
  const d = decodeEmvco(MYR_PAYLOAD);
  assert.equal(d.source, "EMVCO");
  assert.equal(d.crcValid, true);
  assert.equal(d.parseErrors.length, 0);
  assert.equal(d.payloadFormat, "01");
  assert.equal(d.merchantName, "MOVA TEST MERCHANT");
  assert.equal(d.merchantAccount, "M0001");
  assert.equal(d.currencyCode, "458");
  assert.equal(d.amountRaw, "10.00");
  assert.equal(d.amount?.asset, "458");
  assert.equal(d.amount?.amount, "1000"); // 10.00 → smallest units (2 dp)
  assert.equal(d.countryCode, "MY");
});

test("decode: tampered payload fails CRC (fail-closed)", () => {
  const bad = `${MYR_PAYLOAD.slice(0, 8)}9${MYR_PAYLOAD.slice(9)}`;
  const d = decodeEmvco(bad);
  assert.equal(d.crcValid, false);
  assert.ok(d.parseErrors.some((e) => /CRC/i.test(e)));
});

// ---------------------------------------------------------------------------
// QR → normalized intent (same shape as the NL pipe)
// ---------------------------------------------------------------------------

test("qrToStructuredProposal: MYR payload → StructuredIntentProposal", () => {
  const decoded = decodeEmvco(MYR_PAYLOAD);
  const p = qrToStructuredProposal(decoded, ctx);

  assert.equal(p.action, "PAY");
  assert.equal(p.amountRaw, "10.00");
  assert.equal(p.currencyInput, "MYR"); // ISO 458 → alpha
  assert.equal(p.recipient.type, "HANDLE");
  assert.equal(p.recipient.value, "M0001");
  assert.equal(p.recipient.name, "MOVA TEST MERCHANT");
  assert.equal(p.network, "SUI_TESTNET");
  assert.equal(p.confidence, 1);
  assert.equal(p.rawLlmOutput, null);
});

test("qrToStructuredProposal: nested merchant account yields stable identifier", () => {
  const decoded = decodeEmvco(USD_PAYLOAD);
  const { value, name } = extractMerchantIdentifier(decoded);
  assert.equal(value, "ACME0001"); // sub-field 02 of tag 26 preferred
  assert.equal(name, "ACME CORP");
  const p = qrToStructuredProposal(decoded, ctx);
  assert.equal(p.currencyInput, "USD");
  assert.equal(p.recipient.value, "ACME0001");
});

test("summarizeQr: human one-liner", () => {
  const decoded = decodeEmvco(MYR_PAYLOAD);
  assert.equal(summarizeQr(decoded), "Pay 10.00 MYR to MOVA TEST MERCHANT");
});

// ---------------------------------------------------------------------------
// Validation (authority over the QR — same validator as NL)
// ---------------------------------------------------------------------------

test("validateQrDecoded: valid fiat QR is ok but needs token conversion", () => {
  const decoded = decodeEmvco(MYR_PAYLOAD);
  const v = validateQrDecoded(decoded, ctx);

  assert.equal(v.ok, true);
  assert.equal(v.qrErrors.length, 0);
  assert.equal(v.needsTokenConversion, true); // fiat — pick USDC/SUI/MOV
  assert.equal(v.canonicalAmount, null); // fiat is not directly settleable
  assert.ok(v.warnings.some((w) => w.code === "UNSUPPORTED_CURRENCY"));
  assert.equal(v.summary, "Pay 10.00 MYR to MOVA TEST MERCHANT");
  assert.equal(canConfirmQr(v), true);
});

test("validateQrDecoded: tampered payload is blocked regardless of fields", () => {
  const bad = `${MYR_PAYLOAD.slice(0, 8)}9${MYR_PAYLOAD.slice(9)}`;
  const decoded = decodeEmvco(bad);
  assert.equal(decoded.crcValid, false);
  const v = validateQrDecoded(decoded, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.qrErrors.length > 0);
  assert.equal(canConfirmQr(v), false);
});

test("validateQrDecoded: missing amount → MISSING_AMOUNT error, not confirmable", () => {
  const noAmount = payload([
    ["00", "01"],
    ["01", "12"],
    ["02", "M0001"],
    ["53", "458"],
    ["58", "MY"],
    ["59", "MOVA TEST MERCHANT"],
  ]);
  const decoded = decodeEmvco(noAmount);
  const v = validateQrDecoded(decoded, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.code === "MISSING_AMOUNT"));
  assert.equal(canConfirmQr(v), false);
});

test("validateQrDecoded: no merchant → MISSING_RECIPIENT", () => {
  const noMerchant = payload([
    ["00", "01"],
    ["01", "12"],
    ["53", "458"],
    ["54", "10.00"],
    ["58", "MY"],
  ]);
  const decoded = decodeEmvco(noMerchant);
  const v = validateQrDecoded(decoded, ctx);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.code === "MISSING_RECIPIENT"));
});
