/**
 * Deterministic money math for the routing engine.
 *
 * Money is always `{ asset, amount }` with `amount` in the asset's smallest
 * units as a decimal string — NEVER floats. All arithmetic is integer (BigInt).
 * Prices are quoted in a 6-decimal quote asset (default USDC): `priceInt` is
 * the price × 10^6, e.g. "1.000000" → 1_000_000n.
 */
import {
  FIAT_CURRENCY_SET,
  TOKEN_DECIMALS,
  type Money,
} from "@mova/types";

/** Decimal places of price quotes (USDC). */
export const PRICE_SCALE = 6;

/** Identity price (1.0) used when an asset is quoted against itself. */
export const ONE_PRICE = "1.000000";

/** Smallest-unit decimal places for a settleable token or fiat currency. */
export function assetDecimals(asset: string): number {
  if (asset in TOKEN_DECIMALS) return TOKEN_DECIMALS[asset as keyof typeof TOKEN_DECIMALS];
  if (FIAT_CURRENCY_SET.has(asset)) return 2; // ISO 4217 minor units
  return PRICE_SCALE; // unknown quoted asset: assume 6 decimals
}

/** Parse a Money amount as BigInt. */
export function toBigInt(m: Money): bigint {
  return BigInt(m.amount);
}

/** Create a zero Money in `asset`. */
export function zero(asset: string): Money {
  return { asset, amount: "0" };
}

/** True when the amount is zero. */
export function isZero(m: Money): boolean {
  return toBigInt(m) === 0n;
}

/** Integer multiply-then-divide with truncation: (a * num) / den. */
export function mulDiv(a: bigint, num: bigint, den: bigint): bigint {
  return (a * num) / den;
}

/** Apply a basis-point fraction (10000 = 100%). */
export function bpsOf(amount: bigint, basisPoints: number): bigint {
  return (amount * BigInt(basisPoints)) / 10000n;
}

/** Sum Money values that share an asset. */
export function sumMoney(values: Money[]): Money {
  if (values.length === 0) return { asset: "USDC", amount: "0" };
  const asset = values[0]!.asset;
  let total = 0n;
  for (const v of values) {
    if (v.asset !== asset) {
      throw new Error(`cannot sum mixed assets ${asset} + ${v.asset}`);
    }
    total += toBigInt(v);
  }
  return { asset, amount: total.toString() };
}

/** a - b for same-asset values; throws when the result would be negative. */
export function subMoney(a: Money, b: Money): Money {
  if (a.asset !== b.asset) {
    throw new Error(`cannot subtract mixed assets ${a.asset} - ${b.asset}`);
  }
  const diff = toBigInt(a) - toBigInt(b);
  if (diff < 0n) {
    throw new Error(`negative money result for ${a.asset}`);
  }
  return { asset: a.asset, amount: diff.toString() };
}

/** Compare same-asset values: negative, zero, positive. */
export function compareMoney(a: Money, b: Money): number {
  if (a.asset !== b.asset) {
    throw new Error(`cannot compare mixed assets ${a.asset} vs ${b.asset}`);
  }
  const d = toBigInt(a) - toBigInt(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** Parse a 6-decimal price string into an integer: "1.234567" → 1234567n. */
export function priceToInt(price: string): bigint {
  const [whole = "0", frac = ""] = price.split(".");
  const fracPadded = frac.padEnd(PRICE_SCALE, "0").slice(0, PRICE_SCALE);
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fracPadded)) {
    throw new Error(`invalid price "${price}"`);
  }
  return BigInt(`${whole}${fracPadded}`);
}

/**
 * Convert `m` (in its own smallest units) into `quoteAsset` smallest units
 * using `price` = quoteAsset units per 1 base unit. Returns a Money in
 * quoteAsset.
 */
export function toQuote(m: Money, quoteAsset: string, price: string): Money {
  const priceInt = priceToInt(price);
  const amount = (toBigInt(m) * priceInt) / 10n ** BigInt(assetDecimals(m.asset));
  return { asset: quoteAsset, amount: amount.toString() };
}

/**
 * Inverse of `toQuote`: convert a quoteAsset Money into `asset` smallest
 * units using `price` = quoteAsset units per 1 asset unit.
 */
export function fromQuote(quote: Money, asset: string, price: string): Money {
  const priceInt = priceToInt(price);
  const amount = (toBigInt(quote) * 10n ** BigInt(assetDecimals(asset))) / priceInt;
  return { asset, amount: amount.toString() };
}

/**
 * Spread of a quote in basis points: (ask − bid) / mid × 10000.
 * The provider's `bid`/`ask` are integer strings in the price scale
 * (e.g. "999500" == 0.9995 at 10^6); `mid` is the decimal price string.
 * All integer math.
 */
export function spreadBps(bid: string, ask: string, mid: string): number {
  const bidInt = BigInt(bid);
  const askInt = BigInt(ask);
  const midInt = priceToInt(mid);
  if (midInt <= 0n) return 0;
  return Number(((askInt - bidInt) * 10000n) / midInt);
}

/** Render a Money as a human-readable decimal (for reasons/UI), no floats. */
export function toDecimal(m: Money): string {
  const dec = assetDecimals(m.asset);
  const raw = toBigInt(m);
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const str = abs.toString().padStart(dec + 1, "0");
  const whole = str.slice(0, str.length - dec) || "0";
  const frac = str.slice(str.length - dec).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac.length > 0 ? "." + frac : ""}`;
}
