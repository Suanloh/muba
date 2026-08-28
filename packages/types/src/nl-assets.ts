/**
 * Deterministic NL asset/currency/network registry (Phase 2).
 *
 * Shared by BOTH the AI extractor (`@mova/ai`) and the deterministic validator
 * (`@mova/core`) so the two sides can never disagree about what a currency
 * symbol or network alias means. This file is pure data + pure functions.
 *
 * Money is always `{ asset, amount }` with `amount` in smallest units as a
 * decimal string — never floats.
 */
import type { Network } from "./enums.js";
import type { Currency, FiatCurrency, SupportedToken } from "./nl.js";

// ---------------------------------------------------------------------------
// Tokens MOVA settles on Sui
// ---------------------------------------------------------------------------

export const SUPPORTED_TOKENS = ["SUI", "USDC", "MOV"] as const satisfies readonly SupportedToken[];

/** Smallest-unit decimal places per supported token. */
export const TOKEN_DECIMALS: Readonly<Record<SupportedToken, number>> = {
  SUI: 9,
  USDC: 6,
  MOV: 8,
};

// ---------------------------------------------------------------------------
// Fiat currencies MOVA recognizes (not directly settleable — needs conversion)
// ---------------------------------------------------------------------------

export const FIAT_CURRENCIES = [
  "USD",
  "MYR",
  "EUR",
  "SGD",
  "GBP",
  "AUD",
  "JPY",
  "IDR",
  "THB",
  "PHP",
  "VND",
  "HKD",
] as const satisfies readonly FiatCurrency[];

export const FIAT_CURRENCY_SET: ReadonlySet<string> = new Set(FIAT_CURRENCIES);

/**
 * Canonical currency symbol per user-typed token. Keys are lowercased.
 * Includes symbols, ISO codes, and common words. Deterministic.
 */
export const CURRENCY_ALIASES: Readonly<Record<string, string>> = {
  // Tokens
  sui: "SUI",
  usdc: "USDC",
  mov: "MOV",
  // Fiat symbols / ISO
  usd: "USD",
  "$": "USD",
  dollars: "USD",
  "dollar": "USD",
  "us dollars": "USD",
  myr: "MYR",
  rm: "MYR",
  ringgit: "MYR",
  eur: "EUR",
  "€": "EUR",
  euro: "EUR",
  sgd: "SGD",
  gbp: "GBP",
  "£": "GBP",
  aud: "AUD",
  jpy: "JPY",
  "¥": "JPY",
  idr: "IDR",
  thb: "THB",
  php: "PHP",
  vnd: "VND",
  hkd: "HKD",
};

/** Resolve a user-typed currency symbol/token to a canonical Currency. */
export function canonicalCurrency(input: string): Currency {
  const key = input.trim().toLowerCase();
  if (key === "") return "UNKNOWN";
  const mapped = CURRENCY_ALIASES[key];
  if (mapped) return mapped as Currency;
  const upper = key.toUpperCase();
  if ((SUPPORTED_TOKENS as readonly string[]).includes(upper)) return upper as SupportedToken;
  if (FIAT_CURRENCY_SET.has(upper)) return upper as FiatCurrency;
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Decimal normalization (deterministic, no floats)
// ---------------------------------------------------------------------------

/**
 * Validate + normalize a decimal amount string as typed ("1,000.50" → "1000.50").
 * Returns null when the value is not a valid positive decimal.
 */
export function normalizeDecimal(raw: string): string | null {
  let s = raw.trim().replace(/[,\s]/g, "");
  if (s === "") return null;
  // Allow one '.' or ',' decimal separator (comma already stripped above).
  if (!/^\d+(?:\.\d{1,18})?$/.test(s)) return null;
  // Strip leading zeros but keep at least one digit.
  s = s.replace(/^0+(?=\d)/, "");
  if (s === "" || s === ".") return null;
  const [whole = "0", frac = ""] = s.split(".");
  if (BigInt(whole) === 0n && (frac === "" || /^0*$/.test(frac))) return null; // zero
  return s;
}

/** Convert a normalized decimal to smallest units (decimal string). */
export function toSmallestUnits(value: string, decimals: number): string {
  const [whole = "0", frac = ""] = value.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${whole}${fracPadded}`).toString();
}

// ---------------------------------------------------------------------------
// Sui address validation
// ---------------------------------------------------------------------------

/** A Sui address: 0x + 1..64 hex chars (we require >= 8 to avoid false hits). */
export const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{8,64}$/;

export function isValidSuiAddress(value: string): boolean {
  return SUI_ADDRESS_RE.test(value.trim());
}

// ---------------------------------------------------------------------------
// Network aliases (MOVA is Sui-only)
// ---------------------------------------------------------------------------

export const NETWORK_ALIASES: Readonly<Record<string, Network | "UNSUPPORTED">> = {
  sui: "SUI_TESTNET", // bare "Sui" defaults to the expected network (see caller)
  "sui testnet": "SUI_TESTNET",
  "sui:testnet": "SUI_TESTNET",
  testnet: "SUI_TESTNET",
  devnet: "SUI_DEVNET",
  "sui devnet": "SUI_DEVNET",
  "sui:devnet": "SUI_DEVNET",
  mainnet: "SUI_MAINNET",
  "sui mainnet": "SUI_MAINNET",
  "sui:mainnet": "SUI_MAINNET",
  // Non-Sui chains — MOVA refuses them (fail-closed).
  eth: "UNSUPPORTED",
  ethereum: "UNSUPPORTED",
  sol: "UNSUPPORTED",
  solana: "UNSUPPORTED",
  bnb: "UNSUPPORTED",
  "bsc": "UNSUPPORTED",
  arbitrum: "UNSUPPORTED",
  optimism: "UNSUPPORTED",
  base: "UNSUPPORTED",
  polygon: "UNSUPPORTED",
  avax: "UNSUPPORTED",
  avalanche: "UNSUPPORTED",
  tron: "UNSUPPORTED",
};

/** Resolve a network mention (lowercased) to a Network or "UNSUPPORTED". */
export function networkFromAlias(alias: string): Network | "UNSUPPORTED" | null {
  const key = alias.trim().toLowerCase();
  if (key === "") return null;
  const hit = NETWORK_ALIASES[key];
  return hit ?? null;
}
