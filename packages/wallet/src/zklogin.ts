/**
 * @mova/wallet — Sui zkLogin helpers (framework-agnostic, pure).
 *
 * zkLogin lets a Sui account be derived from an OAuth identity (e.g. Google)
 * instead of a private key. Flow:
 *
 *   1. Generate an EPHEMERAL Ed25519 keypair + a single-use OAuth `nonce`
 *      bound to that ephemeral key (createZkLoginNonce).
 *   2. The OAuth provider issues a JWT whose `nonce` claim matches (real mode
 *      fetches this via Google; demo mode fabricates a local one).
 *   3. A zk proof over { sub, iss, aud, salt, nonce, ephemeral public key }
 *      proves the JWT without revealing the OAuth secret (real mode calls the
 *      proving service; demo mode uses clearly-labelled simulated inputs).
 *   4. The Sui address = hash(proof, iss) — deriveZkLoginAddress. The user
 *      signs with the ephemeral key and the signature is wrapped in a zkLogin
 *      signature (createZkLoginSignature / demoZkLoginInputs).
 *
 * Honesty rule (same as the rest of MOVA): this module NEVER fakes a real
 * proof. `createDemoZkLoginSession` derives a REAL zkLogin address but marks
 * `simulated: true` and uses placeholder proof points — the session cannot
 * sign a chain-verifiable transaction (which is fine: MOVA's default browser
 * settlement is simulated and never submits on-chain).
 */
import { Ed25519Keypair, type Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { toBase64 } from "@mysten/sui/utils";
import {
  computeZkLoginAddress,
  decodeJwt,
  genAddressSeed,
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
  jwtToAddress,
  type ZkLoginSignatureInputs,
} from "@mysten/sui/zklogin";
import type { SuiAddress } from "./types.js";

/** zkLogin login mode. `real` needs Google OAuth + a proving service. */
export type ZkLoginMode = "real" | "demo";

/** Decoded OAuth JWT claims MOVA reads. */
export interface ZkLoginClaims {
  sub: string;
  iss: string;
  aud: string;
  nonce?: string;
  exp?: number;
  email?: string;
  name?: string;
}

/**
 * A resolved zkLogin session: everything needed to derive the address and
 * construct signatures for one login. `simulated === true` means the proof
 * inputs are demo placeholders (never chain-verifiable).
 */
export interface ZkLoginSession {
  /** The zkLogin-derived Sui address (the ownership anchor). */
  address: SuiAddress;
  /** Extended ephemeral public key (base64) — what the nonce is bound to. */
  ephemeralPublicKey: string;
  /** OAuth issuer, e.g. "https://accounts.google.com". */
  iss: string;
  aud: string;
  /** The OAuth account key (JWT `sub` claim). */
  sub: string;
  /** Per-user random salt used in address derivation. */
  userSalt: string;
  /** The single-use nonce the JWT / proof is bound to. */
  nonce: string;
  /** Epoch the proof is valid until. */
  maxEpoch: number;
  /** Base64-encoded JWT header (alg/typ) used to reconstruct the signature. */
  headerBase64: string;
  /** Address seed (= hash(salt ‖ "sub" ‖ sub ‖ aud)) for proof inputs. */
  addressSeed: string;
  /** True when the proof/signature is SIMULATED (dev demo, not chain-valid). */
  simulated: boolean;
  /** Provider label for the UI ("MOVA zkLogin (Google)" / "(demo)"). */
  providerLabel: string;
  /** The JWT this session was built from (real, or a fabricated demo one). */
  jwt?: string;
  email?: string;
  /**
   * Real zk proof points (from the proving service). Present only for REAL
   * sessions; demo sessions leave it unset and use placeholder inputs.
   */
  proofPoints?: { a: string[]; b: string[][]; c: string[] };
}

/** Decode a JWT's payload into the typed claims MOVA reads. */
export function parseZkLoginJwt(jwt: string): ZkLoginClaims {
  const decoded = decodeJwt(jwt);
  return {
    sub: decoded.sub,
    iss: decoded.iss,
    aud: decoded.aud,
    nonce: (decoded as unknown as { nonce?: string }).nonce,
    exp: (decoded as unknown as { exp?: number }).exp,
    email: (decoded as unknown as { email?: string }).email,
    name: (decoded as unknown as { name?: string }).name,
  };
}

/** Base64-url encode (no padding) — used to fabricate a demo JWT. */
export function base64UrlEncode(input: string): string {
  const g = globalThis as { btoa?: (s: string) => string };
  const b64 =
    typeof g.btoa === "function"
      ? g.btoa(unescape(encodeURIComponent(input)))
      : Buffer.from(input, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Base64-url decode a JWT segment. */
export function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const g = globalThis as { atob?: (s: string) => string };
  if (typeof g.atob === "function") {
    return decodeURIComponent(escape(g.atob(padded)));
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

/**
 * Generate the single-use OAuth nonce for an ephemeral public key. The JWT the
 * provider issues must carry this exact `nonce` claim.
 */
export function createZkLoginNonce(
  ephemeralPublicKey: Ed25519PublicKey,
  maxEpoch: number,
  randomness?: string,
): string {
  return generateNonce(ephemeralPublicKey, maxEpoch, randomness ?? generateRandomness());
}

/**
 * Derive the zkLogin Sui address from explicit claims. This is the canonical
 * derivation — the same hash the chain uses — so the demo address IS a real
 * zkLogin address even though the proof is simulated.
 */
export function deriveZkLoginAddress(opts: {
  sub: string;
  iss: string;
  aud: string;
  userSalt: string | bigint;
  legacyAddress?: boolean;
}): SuiAddress {
  return computeZkLoginAddress({
    claimName: "sub",
    claimValue: opts.sub,
    iss: opts.iss,
    aud: opts.aud,
    userSalt: opts.userSalt,
    legacyAddress: opts.legacyAddress ?? false,
  });
}

/** Derive the zkLogin address directly from a raw JWT + salt. */
export function deriveZkLoginAddressFromJwt(
  jwt: string,
  userSalt: string | bigint,
  legacyAddress = false,
): SuiAddress {
  return jwtToAddress(jwt, userSalt, legacyAddress);
}

/** Compute the address seed = hash(userSalt ‖ "sub" ‖ sub ‖ aud). */
export function zkLoginAddressSeed(
  userSalt: string | bigint,
  sub: string,
  aud: string,
): string {
  return genAddressSeed(userSalt, "sub", sub, aud).toString();
}

/**
 * Build zkLogin signature inputs for a DEMO session — placeholder proof points
 * (clearly simulated, never chain-verifiable). `issBase64Details` + header are
 * derived from the real session fields so the signature structure is correct.
 */
export function demoZkLoginInputs(session: ZkLoginSession): ZkLoginSignatureInputs {
  const issValue = toBase64(new TextEncoder().encode(session.iss));
  return {
    proofPoints: { a: ["0"], b: [["0"]], c: ["0"] },
    issBase64Details: { value: issValue, indexMod4: session.iss.length % 4 },
    headerBase64: session.headerBase64,
    addressSeed: session.addressSeed,
  };
}

/**
 * Wrap an ephemeral signature into a zkLogin signature. `userSignature` is the
 * base64 of the ephemeral Ed25519 signature bytes. With `demoZkLoginInputs`
 * the result is simulated; with real proof inputs it is chain-verifiable.
 */
export function createZkLoginSignature(opts: {
  inputs: ZkLoginSignatureInputs;
  maxEpoch: number;
  userSignature: string;
}): string {
  return getZkLoginSignature({
    inputs: opts.inputs,
    maxEpoch: opts.maxEpoch,
    userSignature: opts.userSignature,
  });
}

// ---------------------------------------------------------------------------
// Demo zkLogin (offline, deterministic)
// ---------------------------------------------------------------------------

const DEMO_ISSUER = "https://accounts.google.com";
const DEMO_AUDIENCE = "mova-demo";
const DEMO_HEADER = { alg: "RS256", typ: "JWT" };

/** Deterministic demo `sub` from an email (stable across sessions). */
export function demoZkLoginSub(email: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `1${(h >>> 0).toString(10)}${String(email.length).padStart(3, "0")}`;
}

/**
 * Deterministic demo salt from a `sub` (stable across sessions). The salt must
 * parse as a BigInt within the BN254 field (the zkLogin address derivation
 * reduces it mod the field), so we fold the sub into a decimal bigint < 2^254.
 */
export function demoZkLoginSalt(sub: string): string {
  let h = 0n;
  for (let i = 0; i < sub.length; i++) {
    h = (h * 31n + BigInt(sub.charCodeAt(i))) & ((1n << 254n) - 1n);
  }
  return h.toString();
}

/** Fabricate a demo JWT (valid payload shape, fake signature). */
export function buildDemoZkLoginJwt(opts: {
  claims: ZkLoginClaims;
  nonce: string;
  maxEpoch: number;
}): string {
  const header = base64UrlEncode(JSON.stringify(DEMO_HEADER));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: opts.claims.sub,
      iss: opts.claims.iss,
      aud: opts.claims.aud,
      nonce: opts.nonce,
      email: opts.claims.email,
      name: opts.claims.name,
      iat: Math.floor(Date.now() / 1000),
      exp: opts.maxEpoch * 3600,
    }),
  );
  // Demo-only signature segment — this JWT is for local derivation, never sent
  // to a verifying party as authentic.
  const sig = base64UrlEncode("demo-simulated-signature");
  return `${header}.${payload}.${sig}`;
}

export interface DemoZkLoginOptions {
  sub?: string;
  email?: string;
  salt?: string;
  maxEpoch?: number;
  legacyAddress?: boolean;
}

/**
 * Create a DEMO zkLogin session fully offline:
 *  - generates a fresh ephemeral keypair + nonce,
 *  - fabricates a local Google-shaped JWT,
 *  - derives a REAL zkLogin address from the claims,
 *  - marks `simulated: true` (placeholder proof points).
 *
 * Deterministic per (email/sub) — the same email yields the same address, so
 * the demo identity is stable across page reloads.
 */
export function createDemoZkLoginSession(opts: DemoZkLoginOptions = {}): ZkLoginSession {
  const email = opts.email ?? "demo.user@mova.dev";
  const sub = opts.sub ?? demoZkLoginSub(email);
  const iss = DEMO_ISSUER;
  const aud = DEMO_AUDIENCE;
  const userSalt = opts.salt ?? demoZkLoginSalt(sub);
  const legacyAddress = opts.legacyAddress ?? false;
  const keypair = Ed25519Keypair.generate();
  const ephemeralPublicKey = getExtendedEphemeralPublicKey(keypair.getPublicKey());
  const maxEpoch = opts.maxEpoch ?? Math.floor(Date.now() / 1000 / 3600) + 100;
  const nonce = generateNonce(keypair.getPublicKey(), maxEpoch, generateRandomness());
  const address = computeZkLoginAddress({
    claimName: "sub",
    claimValue: sub,
    iss,
    aud,
    userSalt,
    legacyAddress,
  });
  const addressSeed = genAddressSeed(userSalt, "sub", sub, aud).toString();
  const claims: ZkLoginClaims = { sub, iss, aud, nonce, email, name: email.split("@")[0] };
  const jwt = buildDemoZkLoginJwt({ claims, nonce, maxEpoch });

  return {
    address,
    ephemeralPublicKey,
    iss,
    aud,
    sub,
    userSalt,
    nonce,
    maxEpoch,
    headerBase64: base64UrlEncode(JSON.stringify(DEMO_HEADER)),
    addressSeed,
    simulated: true,
    providerLabel: "MOVA zkLogin (demo)",
    jwt,
    email,
  };
}
