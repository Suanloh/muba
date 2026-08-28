/**
 * EMVCo → MOVA currency mapping (Phase 3).
 *
 * EMVCo QR payloads carry the currency as an ISO 4217 *numeric* code in field
 * 53 (e.g. "458" = MYR). MOVA's natural-language layer works with ISO *alpha*
 * symbols (`USD`, `MYR`, `SUI`…). This module is the single deterministic
 * bridge between the two — pure data + pure functions, no network, no LLM.
 *
 * Fiat currencies are NOT directly settleable on Sui: they trigger the same
 * deterministic "conversion required" warning the NLP pipe produces, so a QR
 * fiat amount and a spoken "RM100" behave identically downstream.
 */
import type { Currency } from "@mova/types";

/** ISO 4217 numeric → ISO 4217 alpha for every fiat currency MOVA recognizes. */
export const ISO_4217_NUMERIC_TO_CURRENCY: Readonly<Record<string, Currency>> = {
  "036": "AUD",
  "344": "HKD",
  "360": "IDR",
  "392": "JPY",
  "458": "MYR",
  "608": "PHP",
  "702": "SGD",
  "704": "VND",
  "764": "THB",
  "826": "GBP",
  "840": "USD",
  "978": "EUR",
};

/** Reverse map (alpha → numeric) for display/testing. */
export const CURRENCY_TO_ISO_4217_NUMERIC: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ISO_4217_NUMERIC_TO_CURRENCY).map(([num, alpha]) => [alpha, num]),
);

/**
 * Map an EMVCo field-53 ISO 4217 numeric currency code to a MOVA currency.
 * Returns null when the code is unrecognized (unknown fiat or a non-fiat unit
 * MOVA does not model).
 */
export function currencyFromIso4217Numeric(code: string | null): Currency | null {
  if (!code) return null;
  const hit = ISO_4217_NUMERIC_TO_CURRENCY[code.trim()];
  return hit ?? null;
}

/**
 * ISO 4217 numeric code for a MOVA currency (alpha symbol). Returns null when
 * the currency has no numeric representation (e.g. Sui tokens).
 */
export function iso4217NumericForCurrency(currency: Currency | string): string | null {
  return CURRENCY_TO_ISO_4217_NUMERIC[currency] ?? null;
}

/** Human display label for a currency, e.g. "MYR (RM)" / "USD ($)". */
export function currencyLabel(currency: Currency | string): string {
  switch (currency) {
    case "USD":
      return "USD ($)";
    case "MYR":
      return "MYR (RM)";
    case "EUR":
      return "EUR (€)";
    case "SGD":
      return "SGD (S$)";
    case "GBP":
      return "GBP (£)";
    case "AUD":
      return "AUD (A$)";
    case "JPY":
      return "JPY (¥)";
    case "IDR":
      return "IDR (Rp)";
    case "THB":
      return "THB (฿)";
    case "PHP":
      return "PHP (₱)";
    case "VND":
      return "VND (₫)";
    case "HKD":
      return "HKD (HK$)";
    case "SUI":
    case "USDC":
    case "MOV":
      return String(currency);
    default:
      return String(currency);
  }
}
