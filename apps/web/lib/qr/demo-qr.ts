/**
 * Demo EMVCo QR generator.
 *
 * Produces a REAL, scannable EMVCo merchant-presented QR payload with a valid
 * CRC-16/CCITT (the same `@mova/qr` decoder the scanner uses to verify it), so
 * a phone camera — or the in-app "Load into scanner" button — can demonstrate
 * the full QR → decode → validate → confirm payment flow.
 *
 * The payload mirrors the demo chat example: "Pay RM200 to this merchant."
 */
import { crc16Ccitt, stringToUtf8 } from "@mova/qr";

/** EMVCo TLV field: tag + 2-digit length + value. */
function field(tag: string, value: string): string {
  const len = String(value.length).padStart(2, "0");
  return `${tag}${len}${value}`;
}

export interface DemoQrFields {
  merchantName: string;
  merchantCity: string;
  merchantAccount: string;
  /** ISO 4217 numeric currency code, e.g. "458" (MYR). */
  currencyCode: string;
  /** Human amount as a decimal string, e.g. "200.00". */
  amount: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "MY". */
  countryCode: string;
  /** Merchant category code, e.g. "5411". */
  categoryCode: string;
}

export const DEFAULT_DEMO_QR_FIELDS: DemoQrFields = {
  merchantName: "MOVA TEST MERCHANT",
  merchantCity: "KL",
  merchantAccount: "M0001",
  currencyCode: "458", // MYR
  amount: "200.00",
  countryCode: "MY",
  categoryCode: "5411",
};

/** Build a valid EMVCo payload (CRC-16/CCITT computed over the TLV body). */
export function buildDemoEmvcoPayload(fields: DemoQrFields = DEFAULT_DEMO_QR_FIELDS): string {
  const tlv: Array<[string, string]> = [
    ["00", "01"], // payload format indicator
    ["01", "12"], // point of initiation: dynamic
    ["02", fields.merchantAccount],
    ["52", fields.categoryCode],
    ["53", fields.currencyCode],
    ["54", fields.amount],
    ["58", fields.countryCode],
    ["59", fields.merchantName],
    ["60", fields.merchantCity],
  ];
  const body = tlv.map(([t, v]) => field(t, v)).join("");
  const crc = crc16Ccitt(stringToUtf8(body)).toString(16).toUpperCase().padStart(4, "0");
  return `${body}6304${crc}`;
}

/** The canned demo payload used by the on-screen demo QR. */
export const DEMO_EMVCO_PAYLOAD = buildDemoEmvcoPayload();

/** Human summary shown next to the demo QR. */
export const DEMO_QR_SUMMARY = "Pay RM200.00 to MOVA TEST MERCHANT (M0001)";
