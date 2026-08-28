/**
 * Phase 6 integration tests — Thetanuts (live + static dev) and volatility
 * providers. Verifies the honesty contract: live data is never fabricated,
 * static dev data is always `simulated: true` / `STATIC_DEV`, and unavailable
 * integrations fail with `ERR_INTEGRATION_UNAVAILABLE` (never a fake quote).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MovaError, ErrorCode } from "@mova/logger";
import {
  StaticThetanutsHedgingProvider,
  ThetanutsHedgingProvider,
} from "./thetanuts.js";
import { StaticVolatilityProvider } from "./volatility.js";

const USDC_100 = { asset: "USDC", amount: "100000000" }; // 100 USDC

test("StaticThetanutsHedgingProvider returns an honest simulated PUT quote", async () => {
  const p = new StaticThetanutsHedgingProvider({ allowed: true });
  const q = await p.quote({ asset: "USDC", amount: USDC_100, strategy: "PUT_OPTION", durationDays: 7 });
  assert.equal(q.simulated, true);
  assert.equal(q.dataSource, "STATIC_DEV");
  assert.equal(q.provider, "THETANUTS_STATIC_DEV");
  // 150bp of 100 USDC = 1.50 USDC = 1_500_000 (6-dec).
  assert.equal(q.premium.amount, "1500000");
  assert.equal(q.coverage, 0.5);
});

test("StaticThetanutsHedgingProvider honours a premium override", async () => {
  const p = new StaticThetanutsHedgingProvider({ allowed: true, premiumBps: { PUT_OPTION: 200 } });
  const q = await p.quote({ asset: "USDC", amount: USDC_100, strategy: "PUT_OPTION", durationDays: 7 });
  assert.equal(q.premium.amount, "2000000"); // 2.00 USDC
});

test("StaticThetanutsHedgingProvider refuses to run outside the dev boundary", async () => {
  const p = new StaticThetanutsHedgingProvider({ allowed: false });
  await assert.rejects(
    p.quote({ asset: "USDC", amount: USDC_100, strategy: "PUT_OPTION", durationDays: 7 }),
    (err: unknown) => err instanceof MovaError && err.code === ErrorCode.MOCK_FORBIDDEN,
  );
  await assert.rejects(
    p.getVolatility({ asset: "SUI", horizonDays: 1, confidenceLevel: 0.95 }),
    (err: unknown) => err instanceof MovaError && err.code === ErrorCode.MOCK_FORBIDDEN,
  );
});

test("StaticThetanutsHedgingProvider volatility is static-dev and honest", async () => {
  const p = new StaticThetanutsHedgingProvider({ allowed: true });
  const v = await p.getVolatility({ asset: "SUI", horizonDays: 1, confidenceLevel: 0.95 });
  assert.equal(v.annualizedVol, 0.55);
  assert.equal(v.source, "STATIC_DEV_TABLE");
  assert.equal(v.simulated, true);
  assert.equal(v.horizonDays, 1);
});

test("StaticThetanutsHedgingProvider reports unavailable for unknown assets", async () => {
  const p = new StaticThetanutsHedgingProvider({ allowed: true });
  await assert.rejects(
    p.getVolatility({ asset: "UNKNOWN", horizonDays: 1, confidenceLevel: 0.95 }),
    (err: unknown) => err instanceof MovaError && err.code === ErrorCode.INTEGRATION_UNAVAILABLE,
  );
});

test("StaticVolatilityProvider derives daily vol from annualized vol", async () => {
  const p = new StaticVolatilityProvider({ allowed: true });
  const v = await p.getVolatility({ asset: "MOV", horizonDays: 2, confidenceLevel: 0.95 });
  assert.equal(v.annualizedVol, 0.85);
  assert.ok(Math.abs(v.dailyVol - 0.85 / Math.sqrt(365)) < 1e-9);
});

test("ThetanutsHedgingProvider never fabricates a quote for an unsupported asset", async () => {
  const p = new ThetanutsHedgingProvider({ chainId: 8453, rpcUrl: "https://mainnet.base.org" });
  await assert.rejects(
    p.quote({ asset: "SUI", amount: USDC_100, strategy: "PUT_OPTION", durationDays: 7 }),
    (err: unknown) =>
      err instanceof MovaError &&
      err.code === ErrorCode.INTEGRATION_UNAVAILABLE &&
      /no live Thetanuts V4 option book for SUI/.test(err.message),
  );
});

test("ThetanutsHedgingProvider requires RPC config before attempting live data", async () => {
  const p = new ThetanutsHedgingProvider({ chainId: 8453 });
  await assert.rejects(
    p.quote({ asset: "ETH", amount: USDC_100, strategy: "PUT_OPTION", durationDays: 7 }),
    (err: unknown) =>
      err instanceof MovaError &&
      err.code === ErrorCode.INTEGRATION_UNAVAILABLE &&
      /rpcUrl/.test(err.message),
  );
});

test("ThetanutsHedgingProvider reports unavailable when the SDK is not installed", async () => {
  const p = new ThetanutsHedgingProvider({ chainId: 8453, rpcUrl: "https://mainnet.base.org" });
  await assert.rejects(
    p.getVolatility({ asset: "ETH", horizonDays: 1, confidenceLevel: 0.95 }),
    (err: unknown) =>
      err instanceof MovaError &&
      err.code === ErrorCode.INTEGRATION_UNAVAILABLE &&
      /SDK/.test(err.message),
  );
});

test("ThetanutsHedgingProvider rejects non-Base chains (honest unsupported)", async () => {
  const p = new ThetanutsHedgingProvider({ chainId: 1, rpcUrl: "https://eth.llamarpc.com" });
  await assert.rejects(
    p.quote({ asset: "ETH", amount: USDC_100, strategy: "PUT_OPTION", durationDays: 7 }),
    (err: unknown) =>
      err instanceof MovaError &&
      err.code === ErrorCode.INTEGRATION_UNAVAILABLE &&
      /only supported on chain 8453/.test(err.message),
  );
});
