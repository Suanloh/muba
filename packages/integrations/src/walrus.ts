/**
 * @mova/integrations — Walrus + MemWal (MOVA memory store).
 *
 * Walrus is Sui's decentralized blob storage. MOVA uses it as the "MemWal" —
 * an immutable, verifiable copy of each payment's memory (the audit trail +
 * settlement facts) that survives the app session and can be re-read by
 * blobId.
 *
 * Two providers:
 *  - `WalrusHttpProvider` (REAL): talks to a Walrus HTTP publisher/aggregator
 *    (testnet by default). Fail-closed — any network/HTTP failure throws
 *    INTEGRATION_UNAVAILABLE; it never fabricates a blobId.
 *  - `StaticWalrusStoreProvider` (dev): deterministic in-memory store with a
 *    content-derived fake blobId and `simulated: true` — clearly labelled,
 *    never presented as a real Walrus blob.
 *
 * `MemWalMemoryStore` is the facade the web app uses: REAL Walrus when
 * configured, honest static fallback otherwise (with the reason recorded).
 */
import { MovaError, ErrorCode } from "@mova/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalrusStoreResult {
  /** The Walrus blob id (real) or a deterministic simulated id (static). */
  blobId: string;
  /** True when stored in the static/simulated store (not real Walrus). */
  simulated: boolean;
  /** Public aggregator URL to read the blob (null when simulated). */
  url: string | null;
  /** Honest error note when a real store failed and we fell back. */
  error: string | null;
}

export interface WalrusReadResult {
  blobId: string;
  /** Raw bytes read back (real) or the locally-cached content (static). */
  bytes: Uint8Array;
  text: string;
  simulated: boolean;
  error: string | null;
}

export interface WalrusStoreProvider {
  readonly name: string;
  store(data: string | Uint8Array, opts?: { epochs?: number }): Promise<WalrusStoreResult>;
  read(blobId: string): Promise<WalrusReadResult>;
}

/** Walrus testnet publisher / aggregator endpoints (public). */
export const WALRUS_PUBLISHER_TESTNET = "https://walrus-testnet-publisher.mystenlabs.com/v1/store";
export const WALRUS_AGGREGATOR_TESTNET = "https://aggregator.walrus-testnet.walrus.space/v1/blobs";

// ---------------------------------------------------------------------------
// REAL Walrus HTTP provider
// ---------------------------------------------------------------------------

export class WalrusHttpProvider implements WalrusStoreProvider {
  readonly name = "Walrus HTTP";
  private readonly publisherUrl: string;
  private readonly aggregatorUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    publisherUrl?: string;
    aggregatorUrl?: string;
    timeoutMs?: number;
  } = {}) {
    this.publisherUrl = opts.publisherUrl ?? WALRUS_PUBLISHER_TESTNET;
    this.aggregatorUrl = opts.aggregatorUrl ?? WALRUS_AGGREGATOR_TESTNET;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async store(data: string | Uint8Array, opts: { epochs?: number } = {}): Promise<WalrusStoreResult> {
    // Copy into a fresh Uint8Array<ArrayBuffer> so the fetch BodyInit type is
    // satisfied across both DOM and node typings (TS 5.7 ArrayBufferLike).
    const body =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : Uint8Array.from(data);
    const url = `${this.publisherUrl}?epochs=${opts.epochs ?? 5}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Walrus publisher unreachable (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
    if (!res.ok) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Walrus publisher returned ${res.status} ${res.statusText}.`,
      );
    }
    const json = (await res.json()) as {
      newlyCreated?: { blobObject?: { blobId?: string } };
      alreadyCertified?: { blobId?: string };
    };
    const blobId = json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId;
    if (!blobId) {
      throw new MovaError(ErrorCode.INTEGRATION_UNAVAILABLE, "Walrus publisher returned no blobId.");
    }
    return {
      blobId,
      simulated: false,
      url: `${this.aggregatorUrl}/${blobId}`,
      error: null,
    };
  }

  async read(blobId: string): Promise<WalrusReadResult> {
    let res: Response;
    try {
      res = await fetch(`${this.aggregatorUrl}/${blobId}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Walrus aggregator unreachable (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
    if (!res.ok) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Walrus aggregator returned ${res.status} for blob ${blobId}.`,
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      blobId,
      bytes,
      text: new TextDecoder().decode(bytes),
      simulated: false,
      error: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Static (dev) Walrus store — deterministic, simulated, honest
// ---------------------------------------------------------------------------

/** Deterministic content-derived id (djb2 → 32 hex) for the static store. */
export function simulatedBlobId(data: string | Uint8Array): string {
  const s = typeof data === "string" ? data : new TextDecoder().decode(data);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (h1 + s.charCodeAt(i)) | 0;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, "0");
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  return `mova-static-${a}${b}-${s.length}`;
}

export class StaticWalrusStoreProvider implements WalrusStoreProvider {
  readonly name = "Static Walrus (dev)";
  private readonly cache = new Map<string, string>();

  constructor(private readonly label = "demo") {
    void this.label;
  }

  async store(data: string | Uint8Array, _opts: { epochs?: number } = {}): Promise<WalrusStoreResult> {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const blobId = simulatedBlobId(text);
    this.cache.set(blobId, text);
    return {
      blobId,
      simulated: true,
      url: null,
      error: null,
    };
  }

  async read(blobId: string): Promise<WalrusReadResult> {
    const text = this.cache.get(blobId);
    if (text === undefined) {
      throw new MovaError(ErrorCode.INTEGRATION_UNAVAILABLE, `Static store has no blob ${blobId}.`);
    }
    return {
      blobId,
      bytes: new TextEncoder().encode(text),
      text,
      simulated: true,
      error: null,
    };
  }
}

// ---------------------------------------------------------------------------
// MemWal — MOVA memory snapshots on Walrus
// ---------------------------------------------------------------------------

/** Minimal record facts MemWal needs (decoupled from @mova/wallet types). */
export interface MemoryRecordInput {
  recordId: string;
  correlationId: string;
  ownerAddress: string;
  amount: string;
  asset: string;
  recipient: string;
  network: string;
  state: string;
  planDigest?: string | null;
  txDigest?: string | null;
  simulated?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Optional embedded audit trail / decision log. */
  trail?: unknown;
}

/** Versioned, JSON-serializable memory snapshot (the MemWal blob content). */
export interface MemWalSnapshot {
  schema: "mova.memory.v1";
  recordId: string;
  correlationId: string;
  ownerAddress: string;
  amount: string;
  asset: string;
  recipient: string;
  network: string;
  state: string;
  planDigest: string | null;
  txDigest: string | null;
  simulated: boolean;
  createdAt: number;
  updatedAt: number;
  trail: unknown;
  capturedAt: number;
}

/** Build a deterministic, JSON-serializable memory snapshot from a record. */
export function buildMemorySnapshot(input: MemoryRecordInput): MemWalSnapshot {
  return {
    schema: "mova.memory.v1",
    recordId: input.recordId,
    correlationId: input.correlationId,
    ownerAddress: input.ownerAddress,
    amount: input.amount,
    asset: input.asset,
    recipient: input.recipient,
    network: input.network,
    state: input.state,
    planDigest: input.planDigest ?? null,
    txDigest: input.txDigest ?? null,
    simulated: input.simulated ?? false,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    trail: input.trail ?? null,
    capturedAt: Date.now(),
  };
}

export interface MemWalStoreResult extends WalrusStoreResult {
  snapshot: MemWalSnapshot;
  storedAt: number;
}

/** Persist a payment memory snapshot through a Walrus provider. */
export async function persistMemory(
  walrus: WalrusStoreProvider,
  input: MemoryRecordInput,
  opts: { epochs?: number } = {},
): Promise<MemWalStoreResult> {
  const snapshot = buildMemorySnapshot(input);
  const json = JSON.stringify(snapshot, null, 2);
  const stored = await walrus.store(json, { epochs: opts.epochs ?? 5 });
  return {
    blobId: stored.blobId,
    simulated: stored.simulated,
    url: stored.url,
    error: stored.error,
    snapshot,
    storedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Facade — real Walrus when configured, honest static fallback otherwise
// ---------------------------------------------------------------------------

export class MemWalMemoryStore {
  private readonly real: WalrusHttpProvider | null;
  private readonly staticStore: StaticWalrusStoreProvider;

  constructor(opts: {
    /** Set true (or pass a publisher URL) to use REAL Walrus. */
    useReal?: boolean;
    publisherUrl?: string;
    aggregatorUrl?: string;
  } = {}) {
    const realRequested = opts.useReal === true || Boolean(opts.publisherUrl);
    this.real = realRequested
      ? new WalrusHttpProvider({
          publisherUrl: opts.publisherUrl ?? WALRUS_PUBLISHER_TESTNET,
          aggregatorUrl: opts.aggregatorUrl ?? WALRUS_AGGREGATOR_TESTNET,
        })
      : null;
    this.staticStore = new StaticWalrusStoreProvider();
  }

  /** True when REAL Walrus is configured (else static/demo). */
  get useReal(): boolean {
    return this.real !== null;
  }

  async persist(input: MemoryRecordInput): Promise<MemWalStoreResult> {
    if (this.real) {
      try {
        return await persistMemory(this.real, input);
      } catch (err) {
        // Honest fallback — never fake a real blobId.
        const fallback = await persistMemory(this.staticStore, input);
        return {
          ...fallback,
          error: `REAL Walrus unavailable (${err instanceof Error ? err.message : String(err)}) — stored in static demo memory instead.`,
        };
      }
    }
    return persistMemory(this.staticStore, input);
  }

  async read(blobId: string): Promise<WalrusReadResult> {
    if (this.real && !blobId.startsWith("mova-static-")) {
      try {
        return await this.real.read(blobId);
      } catch (err) {
        throw new MovaError(
          ErrorCode.INTEGRATION_UNAVAILABLE,
          `Walrus read failed (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    }
    return this.staticStore.read(blobId);
  }
}
