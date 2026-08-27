/**
 * Unit tests for @mova/wallet — gate (safety boundary), ownership model,
 * and network handling. Run with `npm test -w @mova/wallet`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WalletExecutionGate,
  type WalletGateContext,
} from "./gate.js";
import {
  createOwnershipAnchor,
  isSuiAddress,
  issuePaymentAuthz,
  issuePaymentReceipt,
  verifyPaymentAuthz,
} from "./ownership.js";
import type { PaymentAuthz } from "./types.js";
import {
  chainForNetwork,
  networkForChain,
  resolveNetworkState,
} from "./network.js";
import { MovaError } from "@mova/logger";

const OWNER = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const OTHER = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

function baseAuthz(overrides: Partial<PaymentAuthz> = {}): PaymentAuthz {
  return issuePaymentAuthz({
    paymentRecordId: "rec_1",
    ownerAddress: OWNER,
    action: "PAY",
    amount: { asset: "SUI", amount: "1000000000" },
    recipient: "0x9999",
    network: "SUI_TESTNET",
    approvalDecision: "APPROVE",
    approvalNonce: "nonce-1",
    issuedAt: 1000,
    ttlMs: 10000,
    ...overrides,
  });
}

function gateCtx(overrides: Partial<WalletGateContext> = {}): WalletGateContext {
  return {
    connected: true,
    ownerAddress: OWNER,
    recordId: "rec_1",
    state: "APPROVED",
    validated: true,
    approved: true,
    authz: baseAuthz(),
    networkMatches: true,
    now: 5000,
    ...overrides,
  };
}

describe("WalletExecutionGate (safety boundary)", () => {
  it("PASS only when validated intent + human approval + valid authz + network match", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx());
    assert.equal(result.allowed, true);
    assert.equal(result.code, "PASS");
  });

  it("fails closed when no wallet is connected", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ connected: false, ownerAddress: null }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "NOT_CONNECTED");
  });

  it("fails closed when the intent is not deterministically validated", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ validated: false }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "NO_VALIDATED_INTENT");
  });

  it("fails closed when the record is not in an executable state", () => {
    const gate = new WalletExecutionGate();
    for (const state of ["CREATED", "PARSED", "AWAITING_APPROVAL"] as const) {
      const result = gate.check(gateCtx({ state }));
      assert.equal(result.allowed, false, `state ${state} must be refused`);
      assert.equal(result.code, "STATE_NOT_EXECUTABLE");
    }
  });

  it("fails closed when there is NO human approval (AI suggestion never executes)", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ approved: false, authz: null }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "NOT_APPROVED");
  });

  it("fails closed when a human approval exists but no wallet-scoped authz was issued", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ approved: true, authz: null }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "AUTHZ_MISSING");
  });

  it("fails closed on an expired authz", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ now: 20000 }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "AUTHZ_EXPIRED");
  });

  it("fails closed when authz owner differs from the connected wallet", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ authz: baseAuthz({ ownerAddress: OTHER }) }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "AUTHZ_OWNER_MISMATCH");
  });

  it("fails closed when authz is bound to a different payment record", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(
      gateCtx({ authz: baseAuthz({ paymentRecordId: "rec_OTHER" }) }),
    );
    assert.equal(result.allowed, false);
    assert.equal(result.code, "AUTHZ_INVALID");
  });

  it("fails closed on a wallet network mismatch", () => {
    const gate = new WalletExecutionGate();
    const result = gate.check(gateCtx({ networkMatches: false }));
    assert.equal(result.allowed, false);
    assert.equal(result.code, "NETWORK_MISMATCH");
  });
});

describe("ownership model", () => {
  it("recognizes valid Sui addresses", () => {
    assert.equal(isSuiAddress("0x1234"), true);
    assert.equal(
      isSuiAddress("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"),
      true,
    );
    assert.equal(isSuiAddress("not-an-address"), false);
    assert.equal(isSuiAddress("0xGGGG"), false);
  });

  it("normalizes the ownership anchor", () => {
    const anchor = createOwnershipAnchor("0xAB");
    assert.equal(anchor.address, "0xab");
  });

  it("refuses to issue a payment authz without an APPROVED human decision", () => {
    assert.throws(
      () =>
        issuePaymentAuthz({
          paymentRecordId: "rec_1",
          ownerAddress: OWNER,
          action: "PAY",
          amount: { asset: "SUI", amount: "1" },
          recipient: "0x9999",
          network: "SUI_TESTNET",
          approvalDecision: "REJECT",
          approvalNonce: "n1",
        }),
      (err: unknown) => err instanceof MovaError,
    );
  });

  it("issues a valid payment authz from an APPROVED decision", () => {
    const authz = baseAuthz();
    const check = verifyPaymentAuthz({
      authz,
      paymentRecordId: "rec_1",
      ownerAddress: OWNER,
      now: 5000,
    });
    assert.equal(check.ok, true);
    assert.equal(authz.decision, "APPROVED");
    assert.equal(authz.nonce, "nonce-1");
  });

  it("verifies an authz but rejects expiry and owner mismatch", () => {
    assert.equal(
      verifyPaymentAuthz({ authz: baseAuthz(), paymentRecordId: "rec_1", ownerAddress: OWNER, now: 5000 }).ok,
      true,
    );
    assert.equal(
      verifyPaymentAuthz({ authz: baseAuthz(), paymentRecordId: "rec_1", ownerAddress: OTHER, now: 5000 }).code,
      "OWNER_MISMATCH",
    );
    assert.equal(
      verifyPaymentAuthz({ authz: baseAuthz(), paymentRecordId: "rec_1", ownerAddress: OWNER, now: 20000 }).code,
      "EXPIRED",
    );
  });

  it("issues a receipt ONLY after the record is SETTLED", () => {
    assert.throws(() =>
      issuePaymentReceipt({
        paymentRecordId: "rec_1",
        ownerAddress: OWNER,
        amount: { asset: "SUI", amount: "1" },
        recipient: "0x9999",
        network: "SUI_TESTNET",
        state: "APPROVED",
        txDigest: null,
        simulated: true,
      }),
    );
    const receipt = issuePaymentReceipt({
      paymentRecordId: "rec_1",
      ownerAddress: OWNER,
      amount: { asset: "SUI", amount: "1" },
      recipient: "0x9999",
      network: "SUI_TESTNET",
      state: "SETTLED",
      txDigest: null,
      simulated: true,
    });
    assert.equal(receipt.simulated, true);
    assert.equal(receipt.ownerAddress, OWNER.toLowerCase());
  });
});

describe("network handling", () => {
  it("maps wallet chains to MOVA networks and back", () => {
    assert.equal(networkForChain("sui:testnet"), "SUI_TESTNET");
    assert.equal(networkForChain("sui:mainnet"), "SUI_MAINNET");
    assert.equal(networkForChain("eth:1"), null);
    assert.equal(chainForNetwork("SUI_TESTNET"), "sui:testnet");
  });

  it("computes network state (match, mismatch, unknown)", () => {
    assert.equal(resolveNetworkState("SUI_TESTNET", "sui:testnet").matches, true);
    const mismatch = resolveNetworkState("SUI_TESTNET", "sui:mainnet");
    assert.equal(mismatch.matches, false);
    assert.equal(mismatch.detectedNetwork, "SUI_MAINNET");
    const unknown = resolveNetworkState("SUI_TESTNET", null);
    assert.equal(unknown.unknown, true);
    assert.equal(unknown.matches, false);
  });
});
