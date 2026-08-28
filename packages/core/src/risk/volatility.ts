/**
 * Deterministic volatility & Value-at-Risk model — Phase 6 risk engine.
 *
 * All arithmetic is integer-safe for money (BigInt) while ratios stay as
 * fixed-point 1e6 integers so the model is reproducible and explainable.
 *
 *   dailyVol      = annualizedVol / sqrt(365)
 *   VaR ratio     = z(confidence) · dailyVol · sqrt(horizonDays)
 *   VaR (money)   = notional × ratioInt / 1e6      (truncating integer math)
 *
 * Nothing here is an LLM output and nothing here touches a network.
 */

/** Trading days used to annualize volatility. */
export const DAYS_PER_YEAR = 365;

/** Fixed-point scale for dimensionless ratios. */
export const RATIO_SCALE = 1_000_000n;

/** Standard-normal quantiles for common confidence levels (one-tailed). */
const Z_TABLE: Readonly<Record<number, number>> = {
  0.8: 0.842,
  0.85: 1.036,
  0.9: 1.282,
  0.95: 1.645,
  0.99: 2.326,
  0.995: 2.576,
};

/** Round a ratio to a 1e6 integer for deterministic integer math. */
export function ratioToInt(ratio: number): bigint {
  return BigInt(Math.round(ratio * Number(RATIO_SCALE)));
}

/** Deterministic standard-normal z-score for a one-tailed confidence level. */
export function zScore(confidenceLevel: number): number {
  const table = Object.keys(Z_TABLE)
    .map(Number)
    .sort((a, b) => a - b);
  const level = Math.min(0.9999, Math.max(0.5, confidenceLevel));
  // Exact table match wins; otherwise pick the nearest available level.
  const exact = Z_TABLE[level];
  if (exact !== undefined) return exact;
  const nearest = table.reduce((best, candidate) =>
    Math.abs(candidate - level) < Math.abs(best - level) ? candidate : best,
  );
  return Z_TABLE[nearest]!;
}

/** Daily volatility from annualized volatility. */
export function dailyVolFromAnnual(annualizedVol: number): number {
  return annualizedVol / Math.sqrt(DAYS_PER_YEAR);
}

/** Annualized volatility from daily volatility. */
export function annualizedFromDaily(dailyVol: number): number {
  return dailyVol * Math.sqrt(DAYS_PER_YEAR);
}

/**
 * The Value-at-Risk ratio: the fraction of notional that could be lost over
 * `horizonDays` at the given confidence, assuming a normal walk.
 */
export function varRatio(dailyVol: number, horizonDays: number, confidenceLevel: number): number {
  if (horizonDays <= 0) return 0;
  return zScore(confidenceLevel) * dailyVol * Math.sqrt(horizonDays);
}

/**
 * Value-at-Risk in the notional's smallest units (integer, truncated):
 * `notional × varRatio / 1e6`.
 */
export function valueAtRisk(notional: bigint, dailyVol: number, horizonDays: number, confidenceLevel: number): bigint {
  const ratio = varRatio(dailyVol, horizonDays, confidenceLevel);
  return (notional * ratioToInt(ratio)) / RATIO_SCALE;
}

/** Clamp a 0..1 ratio into 0..1. */
export function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** Clamp an integer 0..100 contribution. */
export function clamp100(v: number): number {
  if (v <= 0) return 0;
  if (v >= 100) return 100;
  return v;
}

/** Round a dimensionless ratio to 3 decimals for stable scores. */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
