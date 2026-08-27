import type { Money } from "@mova/types";

const DECIMALS: Record<string, number> = { SUI: 9, USDC: 6, MOV: 8 };

/** Format a smallest-unit Money as a human-readable amount (BigInt math only). */
export function formatMoney(money: Money): string {
  const d = DECIMALS[money.asset] ?? 9;
  const bn = BigInt(money.amount);
  const neg = bn < 0n;
  const abs = neg ? -bn : bn;
  const str = abs.toString().padStart(d + 1, "0");
  const whole = str.slice(0, -d) || "0";
  const frac = str.slice(-d).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""} ${money.asset}`;
}

/** Shorten an address for display: 0x1234…abcd. */
export function shortAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Shorten an id (pay_…/receipt_…) for display. */
export function shortId(id: string, n = 14): string {
  return id.length > n ? `${id.slice(0, n)}…` : id;
}
