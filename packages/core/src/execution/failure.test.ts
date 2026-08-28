/**
 * Phase 7 — failure classification tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode, MovaError } from "@mova/logger";
import {
  classifyExecutionFailure,
  classifySettlement,
  failureLabel,
  failureUserMessage,
} from "./failure.js";

describe("classifyExecutionFailure", () => {
  it("maps human rejection to USER_REJECTED (actionable, retryable)", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.APPROVAL_REJECTED, "declined"));
    assert.equal(f.code, "USER_REJECTED");
    assert.equal(f.userActionable, true);
    assert.equal(f.retryable, true);
  });

  it("maps insufficient balance (actionable, retryable)", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.INSUFFICIENT_BALANCE, "need 2 SUI"));
    assert.equal(f.code, "INSUFFICIENT_BALANCE");
    assert.equal(f.userActionable, true);
    assert.equal(f.retryable, true);
  });

  it("maps network failures", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.NETWORK_FAILURE, "RPC unreachable"));
    assert.equal(f.code, "NETWORK_FAILURE");
    assert.equal(f.retryable, true);
  });

  it("maps invalid recipient", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.INTENT_VALIDATION_FAILED, "bad addr"));
    assert.equal(f.code, "INVALID_RECIPIENT");
  });

  it("maps transaction failures as non-retryable when a digest exists", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.SETTLEMENT_FAILED, "reverted"), {
      txDigest: "0xdeadbeef",
    });
    assert.equal(f.code, "TRANSACTION_FAILED");
    assert.equal(f.retryable, false);
    assert.equal(f.txDigest, "0xdeadbeef");
  });

  it("maps timeouts (retryable, no digest)", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.EXECUTION_TIMEOUT, "took too long"));
    assert.equal(f.code, "TIMEOUT");
    assert.equal(f.retryable, true);
  });

  it("maps integration unavailability", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.INTEGRATION_UNAVAILABLE, "thetanuts down"));
    assert.equal(f.code, "INTEGRATION_UNAVAILABLE");
    assert.equal(f.retryable, true);
  });

  it("maps idempotency violations (never retryable)", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.IDEMPOTENCY_VIOLATION, "duplicate"));
    assert.equal(f.code, "IDEMPOTENCY_VIOLATION");
    assert.equal(f.retryable, false);
  });

  it("maps approval expiry", () => {
    const f = classifyExecutionFailure(new MovaError(ErrorCode.APPROVAL_EXPIRED, "window passed"));
    assert.equal(f.code, "APPROVAL_EXPIRED");
    assert.equal(f.userActionable, true);
  });

  it("falls back to UNKNOWN but preserves the message", () => {
    const f = classifyExecutionFailure(new Error("something weird"));
    assert.equal(f.code, "UNKNOWN");
    assert.equal(f.message, "something weird");
    assert.equal(f.retryable, false);
  });

  it("never throws and keeps plain strings", () => {
    const f = classifyExecutionFailure("plain failure");
    assert.equal(f.code, "UNKNOWN");
    assert.equal(f.message, "plain failure");
  });
});

describe("classifySettlement", () => {
  it("returns null for CONFIRMED / SIMULATED", () => {
    assert.equal(classifySettlement("CONFIRMED", null), null);
    assert.equal(classifySettlement("SIMULATED", null), null);
  });

  it("classifies FAILED / REVERTED as TRANSACTION_FAILED", () => {
    const f = classifySettlement("REVERTED", "insufficient gas", { txDigest: "0xabc" });
    assert.equal(f?.code, "TRANSACTION_FAILED");
    assert.equal(f?.txDigest, "0xabc");
  });

  it("classifies SUBMITTED/PENDING as TIMEOUT", () => {
    const f = classifySettlement("SUBMITTED", "no confirmation yet");
    assert.equal(f?.code, "TIMEOUT");
  });
});

describe("labels & messages", () => {
  it("renders human labels", () => {
    assert.equal(failureLabel("USER_REJECTED"), "user rejected");
    assert.equal(failureLabel("INSUFFICIENT_BALANCE"), "insufficient balance");
  });

  it("renders user messages per code", () => {
    assert.match(failureUserMessage(classifyExecutionFailure(new MovaError(ErrorCode.INSUFFICIENT_BALANCE, "low"))), /Insufficient balance/);
    assert.match(failureUserMessage(classifyExecutionFailure(new MovaError(ErrorCode.SETTLEMENT_FAILED, "x"))), /Settlement failed/);
  });
});
