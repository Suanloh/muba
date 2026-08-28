/**
 * Phase 7 — transaction plan construction tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MovaError } from "@mova/logger";
import {
  assertAuthzMatchesSpec,
  assertSpecIntegrity,
  buildTransactionSpec,
  canonicalSpec,
  planDigest,
  summarizeSpec,
} from "./plan.js";
import { sha256Hex } from "./sha256.js";

const BASE = {
  clientRequestId: "pay-abc-123",
  recordId: "rec_1",
  correlationId: "corr-1",
  sender: "0xea179fce0a1b2c3d4e5f60718293a4b5c6d7e8f9",
  recipient: "0x1234567890abcdef1234567890abcdef1234567890",
  amount: { asset: "SUI", amount: "1000000000" }, // 1 SUI
  network: "SUI_TESTNET" as const,
  routeId: "route-1",
  fees: { asset: "USDC", amount: "1000" },
  totalCost: { asset: "USDC", amount: "1000" },
  createdAt: 1000,
  ttlMs: 60000,
};

describe("buildTransactionSpec", () => {
  it("builds a deterministic spec with a stable digest", () => {
    const a = buildTransactionSpec(BASE);
    const b = buildTransactionSpec(BASE);
    assert.equal(a.planDigest, b.planDigest);
    assert.match(a.planDigest, /^[0-9a-f]{64}$/);
    assert.equal(a.version, "1");
    assert.equal(a.kind, "NATIVE_TRANSFER");
    assert.equal(a.expiresAt, 1000 + 60000);
  });

  it("digest changes when any canonical field changes", () => {
    const base = buildTransactionSpec(BASE);
    const other = buildTransactionSpec({ ...BASE, recipient: "0xffffffffffffffffffffffffffffffffffffffff" });
    assert.notEqual(base.planDigest, other.planDigest);
  });

  it("canonical serialization is stable and ordered", () => {
    const spec = buildTransactionSpec(BASE);
    const c1 = canonicalSpec(spec);
    const c2 = canonicalSpec(spec);
    assert.equal(c1, c2);
    assert.ok(c1.includes("recipient:0x1234"));
  });

  it("refuses an invalid recipient (fail-closed)", () => {
    assert.throws(() => buildTransactionSpec({ ...BASE, recipient: "not-an-address" }), MovaError);
    assert.throws(() => buildTransactionSpec({ ...BASE, recipient: "0x1234" }), MovaError);
  });

  it("refuses a non-positive amount", () => {
    assert.throws(() => buildTransactionSpec({ ...BASE, amount: { asset: "SUI", amount: "0" } }), MovaError);
    assert.throws(() => buildTransactionSpec({ ...BASE, amount: { asset: "SUI", amount: "-1" } }), MovaError);
  });

  it("refuses a missing route id", () => {
    assert.throws(() => buildTransactionSpec({ ...BASE, routeId: "" }), MovaError);
  });
});

describe("plan integrity", () => {
  it("assertSpecIntegrity passes for an unmodified spec", () => {
    const spec = buildTransactionSpec(BASE);
    assert.deepEqual(assertSpecIntegrity(spec), { ok: true, reason: null });
  });

  it("assertSpecIntegrity fails when the spec is mutated after build", () => {
    const spec = buildTransactionSpec(BASE);
    const mutated = { ...spec, amount: { asset: "SUI", amount: "999999999999" } };
    const check = assertSpecIntegrity(mutated);
    assert.equal(check.ok, false);
    assert.match(check.reason ?? "", /digest mismatch/);
  });

  it("assertAuthzMatchesSpec binds the authz digest to the spec", () => {
    const spec = buildTransactionSpec(BASE);
    assert.throws(() => assertAuthzMatchesSpec(spec, null), MovaError);
    assert.throws(() => assertAuthzMatchesSpec(spec, "deadbeef"), MovaError);
    assert.doesNotThrow(() => assertAuthzMatchesSpec(spec, spec.planDigest));
  });

  it("summarizeSpec is human-readable", () => {
    const spec = buildTransactionSpec(BASE);
    const s = summarizeSpec(spec);
    assert.ok(s.includes("1000000000 SUI"));
    assert.ok(s.includes("0x1234"));
  });
});

describe("planDigest", () => {
  it("matches the canonical spec hash (stable across calls)", () => {
    const spec = buildTransactionSpec(BASE);
    assert.equal(planDigest(spec), spec.planDigest);
  });

  it("sha256 matches the standard test vector (FIPS 180-4: sha256('abc'))", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("sha256 handles multi-block and empty inputs", () => {
    assert.equal(
      sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" — 2-block
    assert.equal(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
});
