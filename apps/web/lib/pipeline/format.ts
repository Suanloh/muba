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

/** Format an epoch-ms timestamp as a compact local date+time. */
export function formatDateTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a duration (ms) as "3m 12s" / "45s" / "<1s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 1) return "<1s";
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}
