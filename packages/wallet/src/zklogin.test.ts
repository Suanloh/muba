/**
 * zkLogin helper tests — address derivation, nonce, demo session determinism,
 * JWT round-trip and signature construction.
 *
 * These verify REAL zkLogin mechanics: the demo address is derived with the
 * same `computeZkLoginAddress` the chain uses, so the same (email → sub →
 * salt) always yields the same Sui address.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { isValidPersonalMessageSignature } from "@mysten/sui/verify";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildDemoZkLoginJwt,
  createDemoZkLoginSession,
  createZkLoginNonce,
  createZkLoginSignature,
  demoZkLoginInputs,
  demoZkLoginSalt,
  demoZkLoginSub,
  deriveZkLoginAddress,
  deriveZkLoginAddressFromJwt,
  parseZkLoginJwt,
  zkLoginAddressSeed,
} from "./zklogin.js";

test("zkLogin: nonce is a valid length and bound to the ephemeral key", () => {
  const keypair = Ed25519Keypair.generate();
  const nonce = createZkLoginNonce(keypair.getPublicKey(), 1000);
  assert.equal(typeof nonce, "string");
  assert.ok(nonce.length >= 20, "nonce should be long enough to be a valid OAuth nonce");
  // Nonce is stable for the same key+epoch+randomness.
  const nonce2 = createZkLoginNonce(keypair.getPublicKey(), 1000, "42");
  const nonce3 = createZkLoginNonce(keypair.getPublicKey(), 1000, "42");
  assert.equal(nonce2, nonce3);
});

test("zkLogin: deriveZkLoginAddress is deterministic and a valid Sui address", () => {
  const a1 = deriveZkLoginAddress({ sub: "1234567890", iss: "https://accounts.google.com", aud: "mova-demo", userSalt: "0xabcdef" });
  const a2 = deriveZkLoginAddress({ sub: "1234567890", iss: "https://accounts.google.com", aud: "mova-demo", userSalt: "0xabcdef" });
  assert.equal(a1, a2);
  assert.match(a1, /^0x[0-9a-f]{64}$/);
  // Different salt => different address.
  const a3 = deriveZkLoginAddress({ sub: "1234567890", iss: "https://accounts.google.com", aud: "mova-demo", userSalt: "0x999999" });
  assert.notEqual(a1, a3);
});

test("zkLogin: demo sub/salt are deterministic per email", () => {
  const sub = demoZkLoginSub("alice@mova.dev");
  const sub2 = demoZkLoginSub("alice@mova.dev");
  assert.equal(sub, sub2);
  assert.match(sub, /^\d+$/);
  assert.equal(demoZkLoginSalt(sub), demoZkLoginSalt(sub2));
  // Different email -> different sub.
  assert.notEqual(demoZkLoginSub("bob@mova.dev"), sub);
});

test("zkLogin: demo session derives a real zkLogin address, stable per email", () => {
  const s1 = createDemoZkLoginSession({ email: "alice@mova.dev" });
  const s2 = createDemoZkLoginSession({ email: "alice@mova.dev" });
  assert.equal(s1.simulated, true);
  assert.match(s1.address, /^0x[0-9a-f]{64}$/);
  // The address is derived from claims, NOT the random ephemeral key — so the
  // same email always maps to the same zkLogin address across sessions.
  assert.equal(s1.address, s2.address);
  assert.equal(s1.sub, s2.sub);
  assert.equal(s1.iss, "https://accounts.google.com");
  assert.ok(s1.ephemeralPublicKey.length > 40, "has an extended ephemeral key");
  assert.ok(s1.nonce.length >= 20, "has a nonce");
});

test("zkLogin: demo session address matches deriveZkLoginAddress + jwtToAddress", () => {
  const s = createDemoZkLoginSession({ email: "bob@mova.dev" });
  const fromClaims = deriveZkLoginAddress({ sub: s.sub, iss: s.iss, aud: s.aud, userSalt: s.userSalt });
  assert.equal(fromClaims, s.address);
  const fromJwt = deriveZkLoginAddressFromJwt(s.jwt!, s.userSalt);
  assert.equal(fromJwt, s.address);
});

test("zkLogin: address seed is consistent with the derived address", () => {
  const s = createDemoZkLoginSession({ email: "carol@mova.dev" });
  const seed = zkLoginAddressSeed(s.userSalt, s.sub, s.aud);
  assert.equal(seed, s.addressSeed);
  assert.match(seed, /^\d+$/);
});

test("zkLogin: demo JWT round-trips through parseZkLoginJwt", () => {
  const s = createDemoZkLoginSession({ email: "dave@mova.dev" });
  const claims = parseZkLoginJwt(s.jwt!);
  assert.equal(claims.sub, s.sub);
  assert.equal(claims.iss, s.iss);
  assert.equal(claims.aud, s.aud);
  assert.equal(claims.nonce, s.nonce);
  assert.equal(claims.email, "dave@mova.dev");
});

test("zkLogin: base64url encode/decode round-trip", () => {
  const payload = JSON.stringify({ hello: "世界", n: 42 });
  const encoded = base64UrlEncode(payload);
  assert.ok(!encoded.includes("="), "no padding");
  assert.ok(!encoded.includes("+") && !encoded.includes("/"), "url-safe chars only");
  assert.equal(base64UrlDecode(encoded), payload);
});

test("zkLogin: demo signature is constructible and marked simulated (never chain-valid)", async () => {
  const s = createDemoZkLoginSession({ email: "erin@mova.dev" });
  const keypair = Ed25519Keypair.generate(); // demo uses a fresh ephemeral key
  const { signature: ephemeralSig } = await keypair.signPersonalMessage(new TextEncoder().encode("MOVA authz"));
  const zkSig = createZkLoginSignature({
    inputs: demoZkLoginInputs(s),
    maxEpoch: s.maxEpoch,
    userSignature: Buffer.from(ephemeralSig).toString("base64"),
  });
  assert.equal(typeof zkSig, "string");
  // In @mysten/sui 2.x the zkLogin signature scheme byte is 0x05 (first byte
  // of the decoded signature), so the base64 payload starts with "BQ…".
  assert.equal(Buffer.from(zkSig, "base64")[0], 0x05, "zkLogin signature scheme byte");
  // Honesty: with placeholder proof points the signature must NOT verify as a
  // valid personal-message signature (it is simulated, never real).
  const ok = await isValidPersonalMessageSignature(
    new TextEncoder().encode("MOVA authz"),
    zkSig,
    { address: s.address },
  );
  assert.equal(ok, false, "simulated proof must never verify on-chain");
});

test("zkLogin: buildDemoZkLoginJwt is a 3-segment JWT", () => {
  const s = createDemoZkLoginSession({ email: "frank@mova.dev" });
  const jwt = buildDemoZkLoginJwt({ claims: { sub: s.sub, iss: s.iss, aud: s.aud, email: "frank@mova.dev" }, nonce: s.nonce, maxEpoch: s.maxEpoch });
  assert.equal(jwt.split(".").length, 3);
});
