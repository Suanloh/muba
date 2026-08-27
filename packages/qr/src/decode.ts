/**
 * High-level local EMVCo QR decoder.
 *
 * Deterministic, dependency-light, no network, no LLM. Used by the
 * `createFromQr` path: the decoded amount/account are trusted structured
 * inputs; the AI layer may assist interpretation but never overwrites them.
 */
import type { QrDecoder } from "@mova/core";
import type { Money, QrDecoded } from "@mova/types";
import { crc16Ccitt, stringToUtf8 } from "./crc.js";
import { parseTlv } from "./tlv.js";

/** Merchant account single tags (02–05) then multi (26–51). */
const MERCHANT_ACCOUNT_TAGS = [
  "02", "03", "04", "05",
  "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37",
  "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "50", "51",
] as const;

/** EMVCo fiat amounts are decimal with up to 2 fractional digits. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

const CRC_HEX = /^[0-9A-F]{4}$/i;

/** "10.00" / "10" / "10.5" -> smallest units ("1000"). Null on invalid. */
function amountToSmallestUnits(raw: string): string | null {
  const normalized = raw.trim();
  if (!AMOUNT_PATTERN.test(normalized)) return null;
  const [intPart, fracPart = ""] = normalized.split(".");
  const scaled = `${intPart}${fracPart.padEnd(2, "0")}`;
  // Strip leading zeros but keep at least one digit.
  return scaled.replace(/^0+(?=\d)/, "");
}

export function decodeEmvco(payload: string): QrDecoded {
  const parseErrors: string[] = [];
  const trimmed = payload.trim();

  // CRC (EMVCo field 63) is last: "6304" + 4 hex digits, computed over the rest.
  let crcValid = false;
  let body = trimmed;
  if (trimmed.length >= 8 && trimmed.slice(-8, -4) === "6304") {
    const crcHex = trimmed.slice(-4);
    if (CRC_HEX.test(crcHex)) {
      body = trimmed.slice(0, -8);
      const expected = parseInt(crcHex, 16);
      const actual = crc16Ccitt(stringToUtf8(body));
      crcValid = actual === expected;
      if (!crcValid) parseErrors.push("CRC mismatch");
    } else {
      parseErrors.push("malformed CRC field (63)");
    }
  } else {
    parseErrors.push("missing or malformed CRC field (63)");
  }

  const { fields, errors } = parseTlv(body);
  parseErrors.push(...errors);
  const byTag = new Map(fields.map((f) => [f.tag, f.value]));

  const currencyCode = byTag.get("53") ?? null;
  const amountRaw = byTag.get("54") ?? null;
  const scaled = amountRaw ? amountToSmallestUnits(amountRaw) : null;
  const amount: Money | null =
    currencyCode && scaled ? { asset: currencyCode, amount: scaled } : null;

  let merchantAccount: string | null = null;
  for (const tag of MERCHANT_ACCOUNT_TAGS) {
    const value = byTag.get(tag);
    if (value) {
      merchantAccount = value;
      break;
    }
  }

  let reference: string | null = null;
  let billNumber: string | null = null;
  const additionalData = byTag.get("62");
  if (additionalData) {
    const sub = parseTlv(additionalData);
    reference = sub.fields.find((f) => f.tag === "03")?.value ?? null;
    billNumber = sub.fields.find((f) => f.tag === "01")?.value ?? null;
  }

  return {
    source: "EMVCO",
    payloadFormat: byTag.get("00") ?? null,
    merchantName: byTag.get("59") ?? null,
    merchantCity: byTag.get("60") ?? null,
    merchantAccount,
    categoryCode: byTag.get("52") ?? null,
    currencyCode,
    amountRaw,
    amount,
    countryCode: byTag.get("58") ?? null,
    reference,
    billNumber,
    crcValid,
    raw: trimmed,
    parseErrors,
  };
}

/** Implements the `QrDecoder` contract from `@mova/core`. */
export class EmvcoQrDecoder implements QrDecoder {
  decode(payload: string): QrDecoded {
    return decodeEmvco(payload);
  }
}
