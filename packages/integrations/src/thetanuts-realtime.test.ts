/**
 * Realtime Thetanuts OptionBook feed tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MovaError, ErrorCode } from "@mova/logger";
import { THETANUTS_LIVE_UNDERLYINGS, ThetanutsRealtimeFeed } from "./index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("simulated feed emits an honest STATIC_DEV tick immediately", async () => {
  const feed = new ThetanutsRealtimeFeed({
    allowed: true,
    underlyings: ["SUI"],
    intervalMs: 60_000, // never fires during the test
    random: () => 0.5, // deterministic walk
  });
  const ticks: Array<{ asset: string; simulated: boolean }> = [];
  const unsub = feed.subscribe((t) => ticks.push(t));
  await sleep(5);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0]!.asset, "SUI");
  const t = ticks[0] as unknown as { simulated: boolean; dataSource: string };
  assert.equal(t.simulated, true);
  assert.equal(t.dataSource, "STATIC_DEV");
  unsub();
});

test("realtime stream emits multiple ticks on interval", async () => {
  const feed = new ThetanutsRealtimeFeed({
    allowed: true,
    underlyings: ["SUI", "ETH"],
    intervalMs: 5,
    random: () => 0.42,
  });
  const ticks: string[] = [];
  const unsub = feed.subscribe((t) => ticks.push(`${t.asset}:${t.simulated ? "sim" : "live"}`));
  await sleep(40);
  unsub();
  assert.ok(ticks.length >= 2, `expected multiple ticks, got ${ticks.length}`);
  assert.ok(ticks.includes("SUI:sim"));
  assert.ok(ticks.includes("ETH:sim"));
});

test("unsubscribe stops the interval", async () => {
  const feed = new ThetanutsRealtimeFeed({ allowed: true, underlyings: ["SUI"], intervalMs: 5 });
  const ticks: unknown[] = [];
  const unsub = feed.subscribe((t) => ticks.push(t));
  await sleep(15);
  const count = ticks.length;
  unsub();
  await sleep(20);
  assert.equal(ticks.length, count); // no new ticks after unsubscribe
});

test("simulated fallback refuses to run outside the dev boundary (mainnet)", () => {
  const feed = new ThetanutsRealtimeFeed({ allowed: false, underlyings: ["SUI"] });
  assert.throws(
    () => feed.subscribe(() => {}),
    (err) => err instanceof MovaError && err.code === ErrorCode.MOCK_FORBIDDEN,
  );
});

test("live underlyings list is ETH/BTC only (the rest fall back honestly)", () => {
  assert.deepEqual([...THETANUTS_LIVE_UNDERLYINGS].sort(), ["BTC", "ETH"]);
});
