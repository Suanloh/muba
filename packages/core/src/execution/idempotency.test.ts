/**
 * Phase 7 — idempotency guard tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MovaError } from "@mova/logger";
import { buildTransactionSpec } from "./plan.js";
import {
  beginExecution,
  isExecuted,
  markExecuted,
  markFailed,
} from "./idempotency.js";
import type { PaymentExecutionInfo } from "@mova/types";
import { classifyExecutionFailure } from "./failure.js";

const BASE = {
  clientRequestId: "pay-abc-123",
  recordId: "rec_1",
  correlationId: "corr-1",
  sender: "0xea179fce0a1b2c3d4e5f60718293a4b5c6d7e8f9",
  recipient: "0x1234567890abcdef1234567890abcdef1234567890",
  amount: { asset: "SUI", amount: "1000000000" },
  network: "SUI_TESTNET" as const,
  routeId: "route-1",
  fees: { asset: "USDC", amount: "1000" },
  totalCost: { asset: "USDC", amount: "1000" },
  createdAt: 1000,
  ttlMs: 60000,
};

function specAt(now = 1000) {
  return buildTransactionSpec({ ...BASE, createdAt: now, ttlMs: 60000 });
}

describe("beginExecution", () => {
  it("allows the first attempt and seeds execution state", () => {
    const spec = specAt();
    const res = beginExecution(null, spec, 1000);
    assert.equal(res.reason, null);
    assert.equal(res.state.clientRequestId, "pay-abc-123");
    assert.equal(res.state.specDigest, spec.planDigest);
    assert.equal(res.state.attempts, 1);
    assert.equal(res.state.executedAt, null);
  });

  it("refuses a duplicate execution once executed", () => {
    const spec = specAt();
    const first = beginExecution(null, spec, 1000).state;
    const done = markExecuted(first, "CONFIRMED", 1001);
    assert.throws(() => beginExecution(done, spec, 1002), MovaError);
  });

  it("refuses a replay with a changed digest for the same clientRequestId", () => {
    const spec = specAt();
    const first = beginExecution(null, spec, 1000).state;
    const mutated = buildTransactionSpec({ ...BASE, amount: { asset: "SUI", amount: "2000000000" } });
    try {
      beginExecution(first, mutated, 1001);
      assert.fail("expected MovaError");
    } catch (err) {
      assert.ok(err instanceof MovaError);
      assert.equal(err.code, "ERR_IDEMPOTENCY_VIOLATION");
    }
  });

  it("refuses an expired execution window", () => {
    const spec = specAt(1000); // expires at 61000
    assert.throws(() => beginExecution(null, spec, 61001), MovaError);
  });

  it("increments attempts for a non-terminal retry", () => {
    const spec = specAt();
    const first = beginExecution(null, spec, 1000).state;
    const retry = beginExecution(first, spec, 2000);
    assert.equal(retry.state.attempts, 2);
    assert.equal(retry.state.executedAt, null);
    assert.match(retry.reason ?? "", /retrying/);
  });
});

describe("markExecuted / markFailed", () => {
  it("records a successful settlement exactly once", () => {
    const spec = specAt();
    const state: PaymentExecutionInfo = beginExecution(null, spec, 1000).state;
    const done = markExecuted(state, "CONFIRMED", 2000);
    assert.equal(done.executedAt, 2000);
    assert.equal(done.settlement, "CONFIRMED");
    assert.equal(isExecuted(done), true);
    assert.throws(() => markExecuted(done, "CONFIRMED", 2001), MovaError);
  });

  it("records a terminal failure on the attempt state", () => {
    const spec = specAt();
    const state = beginExecution(null, spec, 1000).state;
    const failure = classifyExecutionFailure(new MovaError("ERR_SETTLEMENT_FAILED", "boom"));
    const failed = markFailed(state, failure, 2000);
    assert.equal(failed.failure?.code, "TRANSACTION_FAILED");
    assert.equal(failed.settlement, "FAILED");
    assert.equal(isExecuted(failed), false);
  });
});
