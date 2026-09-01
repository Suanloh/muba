"use client";
/**
 * MOVA zkLogin client (browser side).
 *
 * Two modes:
 *  - `demo` (default): fully offline. Generates an ephemeral keypair + nonce,
 *    fabricates a Google-shaped JWT locally, and derives a REAL zkLogin Sui
 *    address. The proof inputs are simulated placeholders (marked
 *    `simulated: true`) — the session can never submit a chain-verifiable
 *    transaction, which matches MOVA's default simulated settlement.
 *  - `real`: real Google OAuth + Mysten zkLogin proving service. Requires
 *    `NEXT_PUBLIC_ZKLOGIN_GOOGLE_CLIENT_ID` + `NEXT_PUBLIC_ZKLOGIN_REDIRECT_URI`
 *    (+ optional `NEXT_PUBLIC_ZKLOGIN_PROVER_URL`). When unconfigured this
 *    path throws a clear, honest error and the demo path is used instead.
 *
 * The wallet-standard wallet (`zklogin-wallet.ts`) calls `loginZkLogin()`;
 * this module owns the derivation + proof fetch so the wallet stays thin.
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64 } from "@mysten/sui/utils";
import type { ZkLoginSignatureInputs } from "@mysten/sui/zklogin";
import {
  createDemoZkLoginSession,
  demoZkLoginInputs,
  deriveZkLoginAddress,
  parseZkLoginJwt,
  type ZkLoginClaims,
  type ZkLoginMode,
  type ZkLoginSession,
} from "@mova/wallet";
import { MovaError, ErrorCode } from "@mova/logger";
import { dappNetworkRpcUrl, EXPECTED_NETWORK } from "./networks";

/** Env-gated zkLogin configuration (no secrets; client id is public). */
export const ZKLOGIN_CONFIG = {
  googleClientId: process.env.NEXT_PUBLIC_ZKLOGIN_GOOGLE_CLIENT_ID ?? "",
  redirectUri: process.env.NEXT_PUBLIC_ZKLOGIN_REDIRECT_URI ?? "",
  proverUrl: process.env.NEXT_PUBLIC_ZKLOGIN_PROVER_URL ?? "https://prover.mystenlabs.com/v1",
  get enabled() {
    return this.googleClientId !== "" && this.redirectUri !== "";
  },
} as const;

/** localStorage key for the per-user zkLogin salt. */
const SALT_KEY = "mova-zklogin-salt";

/** Read (or create) the per-user salt used in address derivation. */
export function loadOrCreateUserSalt(sub: string): string {
  try {
    const existing = localStorage.getItem(`${SALT_KEY}:${sub}`);
    if (existing) return existing;
  } catch {
    /* private mode — fall through to a fresh salt */
  }
  // Fresh random salt within the BN254 field (BigInt-friendly decimal).
  const salt = (crypto.getRandomValues(new Uint32Array(4))
    .reduce((acc, x) => (acc * 0x100000000n + BigInt(x)) & ((1n << 254n) - 1n), 0n))
    .toString();
  try {
    localStorage.setItem(`${SALT_KEY}:${sub}`, salt);
  } catch {
    /* ignore */
  }
  return salt;
}

/** Fetch a fresh ephemeral keypair (private key stays in memory, never leaves). */
export function createEphemeralKeypair(): Ed25519Keypair {
  return Ed25519Keypair.generate();
}

/**
 * Read the CURRENT Sui epoch from the network RPC and add a validity buffer.
 * The zkLogin nonce + proof are bound to this epoch window; the proving
 * service and the chain expect a real Sui epoch, not an arbitrary clock value.
 *
 * Uses the gRPC client (the public fullnodes deprecated JSON-RPC; the app's
 * dApp-kit already talks to the same endpoint over gRPC-Web).
 */
async function currentEpochWithBuffer(buffer: number): Promise<number> {
  const dappNet =
    EXPECTED_NETWORK === "SUI_DEVNET"
      ? "devnet"
      : EXPECTED_NETWORK === "SUI_MAINNET"
        ? "mainnet"
        : "testnet";
  const { SuiGrpcClient } = await import("@mysten/sui/grpc");
  const client = new SuiGrpcClient({
    network: dappNet,
    baseUrl: dappNetworkRpcUrl(dappNet),
  });
  const state = await client.getCurrentSystemState();
  const raw = (state as unknown as { systemState?: { epoch?: string } }).systemState;
  const epoch = raw && raw.epoch !== undefined ? Number(raw.epoch) : Number.NaN;
  if (!Number.isFinite(epoch)) {
    throw new MovaError(
      ErrorCode.WALLET_CONNECTION_FAILED,
      "Sui RPC did not return the current epoch.",
    );
  }
  return epoch + buffer;
}

/**
 * Demo login — offline, deterministic per email. Returns a session with a
 * REAL zkLogin-derived address and `simulated: true`.
 */
export function loginZkLoginDemo(email?: string): ZkLoginSession {
  return createDemoZkLoginSession({ email });
}

/**
 * Real login — Google OAuth popup + zkLogin proving service. Throws a clear
 * error when not configured. Not exercisable in the embedded/offline demo
 * (needs a registered OAuth client + network), so it is guarded and honest.
 */
export async function loginZkLoginReal(): Promise<ZkLoginSession> {
  if (!ZKLOGIN_CONFIG.enabled) {
    throw new MovaError(
      ErrorCode.WALLET_CONNECTION_FAILED,
      "Real zkLogin is not configured — set NEXT_PUBLIC_ZKLOGIN_GOOGLE_CLIENT_ID and NEXT_PUBLIC_ZKLOGIN_REDIRECT_URI. Using demo zkLogin instead.",
    );
  }
  const keypair = createEphemeralKeypair();
  // ONE randomness drives BOTH the OAuth nonce (sent to Google) and the proof
  // request (`jwtRandomness`). The proving service recomputes the expected
  // nonce from (extendedEphemeralPublicKey, maxEpoch, jwtRandomness) and
  // compares it to the JWT's `nonce` claim — they MUST be the same value or
  // the prover returns 400.
  const { generateRandomness } = await import("@mysten/sui/zklogin");
  const jwtRandomness = generateRandomness();
  // Bound the proof to the REAL current Sui epoch + a validity buffer (the
  // hours-since-epoch value the code used before is not a Sui epoch and is
  // rejected by the proving service).
  const maxEpoch = await currentEpochWithBuffer(100);
  const jwt = await fetchGoogleIdToken(keypair, maxEpoch, jwtRandomness);
  const claims = parseZkLoginJwt(jwt);
  const userSalt = loadOrCreateUserSalt(claims.sub);
  const address = deriveZkLoginAddress({
    sub: claims.sub,
    iss: claims.iss,
    aud: claims.aud,
    userSalt,
  });
  const inputs = await fetchZkProof({ jwt, keypair, maxEpoch, claims, userSalt, jwtRandomness });
  return {
    address,
    ephemeralPublicKey: (await import("@mysten/sui/zklogin")).getExtendedEphemeralPublicKey(keypair.getPublicKey()),
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    userSalt,
    nonce: claims.nonce ?? "",
    maxEpoch,
    headerBase64: jwt.split(".")[0] ?? "",
    addressSeed: inputs.addressSeed,
    simulated: false,
    providerLabel: "MOVA zkLogin (Google)",
    jwt,
    email: claims.email,
    proofPoints: inputs.proofPoints,
  };
}

/** Open the Google OAuth popup and wait for the `id_token` to come back. */
async function fetchGoogleIdToken(
  keypair: Ed25519Keypair,
  maxEpoch: number,
  jwtRandomness: string,
): Promise<string> {
  const { generateNonce } = await import("@mysten/sui/zklogin");
  const nonce = generateNonce(keypair.getPublicKey(), maxEpoch, jwtRandomness);
  const params = new URLSearchParams({
    client_id: ZKLOGIN_CONFIG.googleClientId,
    redirect_uri: ZKLOGIN_CONFIG.redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    nonce,
    prompt: "select_account",
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const popup = window.open(url, "mova-zklogin", "popup=yes,width=480,height=640");
  if (!popup) {
    throw new MovaError(
      ErrorCode.WALLET_CONNECTION_FAILED,
      "Could not open the Google sign-in popup (popup blocked?). Allow popups and try again.",
    );
  }

  // Wait for the redirect back to redirectUri carrying #id_token=<jwt>.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const loc = popup.location.href;
      if (loc && loc.includes("id_token=")) {
        const jwt = new URL(loc).hash.match(/id_token=([^&]+)/)?.[1];
        popup.close();
        if (jwt) return decodeURIComponent(jwt);
      }
    } catch {
      // Cross-origin read of the popup URL throws until it redirects to our
      // (same-origin) redirect_uri — poll until it does or times out.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  popup.close();
  throw new MovaError(ErrorCode.WALLET_CONNECTION_FAILED, "Google sign-in timed out. Try again.");
}

/** Fetch the zkLogin zero-knowledge proof from the proving service. */
async function fetchZkProof(opts: {
  jwt: string;
  keypair: Ed25519Keypair;
  maxEpoch: number;
  claims: ZkLoginClaims;
  userSalt: string;
  /** The SAME randomness used to build the OAuth nonce (must match). */
  jwtRandomness: string;
}): Promise<{
  proofPoints: { a: string[]; b: string[][]; c: string[] };
  headerBase64: string;
  addressSeed: string;
}> {
  const { genAddressSeed, getExtendedEphemeralPublicKey } = await import("@mysten/sui/zklogin");
  const { jwt, keypair, maxEpoch, claims, userSalt, jwtRandomness } = opts;
  const extendedEphemeralPublicKey = getExtendedEphemeralPublicKey(keypair.getPublicKey());
  const addressSeed = genAddressSeed(userSalt, "sub", claims.sub, claims.aud).toString();

  const body = {
    jwt,
    extendedEphemeralPublicKey,
    maxEpoch,
    jwtRandomness,
    salt: userSalt,
    keyClaimName: "sub",
  };

  let res: Response;
  try {
    res = await fetch(ZKLOGIN_CONFIG.proverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new MovaError(
      ErrorCode.WALLET_CONNECTION_FAILED,
      `zkLogin proving service unreachable (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!res.ok) {
    throw new MovaError(
      ErrorCode.WALLET_CONNECTION_FAILED,
      `zkLogin proving service returned ${res.status}.`,
    );
  }
  const data = (await res.json()) as {
    proofPoints?: { groth16?: { a?: string[]; b?: string[][]; c?: string[] } };
  };
  const g = data.proofPoints?.groth16;
  if (!g?.a || !g.b || !g.c) {
    throw new MovaError(ErrorCode.WALLET_CONNECTION_FAILED, "zkLogin proving service returned no proof.");
  }
  const headerBase64 = opts.jwt.split(".")[0] ?? "";
  return {
    proofPoints: { a: g.a, b: g.b, c: g.c },
    headerBase64,
    addressSeed,
  };
}

/**
 * Inputs + maxEpoch used to wrap an ephemeral signature. Real sessions carry
 * real proof points from the proving service; demo sessions use clearly
 * labelled placeholder inputs (never chain-verifiable).
 */
export function zkLoginSigningMaterial(session: ZkLoginSession): {
  inputs: ZkLoginSignatureInputs;
  maxEpoch: number;
} {
  const inputs: ZkLoginSignatureInputs = session.proofPoints
    ? {
        proofPoints: session.proofPoints,
        issBase64Details: {
          value: toBase64(new TextEncoder().encode(session.iss)),
          indexMod4: session.iss.length % 4,
        },
        headerBase64: session.headerBase64,
        addressSeed: session.addressSeed,
      }
    : demoZkLoginInputs(session);
  return { inputs, maxEpoch: session.maxEpoch };
}

/** Resolve which login mode to use (real when configured, else demo). */
export function resolveZkLoginMode(): ZkLoginMode {
  return ZKLOGIN_CONFIG.enabled ? "real" : "demo";
}
