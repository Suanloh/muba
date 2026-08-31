/**
 * Thetanuts V4 OptionBook — realtime feed.
 *
 * Streams live option-book ticks (implied vol, delta, premium, expiry) for the
 * Thetanuts-supported underlyings (ETH/BTC on Base mainnet) by polling the
 * REAL OptionBook through `ThetanutsHedgingProvider`.
 *
 * Honesty rules (same as the rest of the integration):
 *   - When a live book is reachable the tick is `dataSource: "LIVE"`,
 *     `simulated: false`.
 *   - When it isn't (SDK missing, network down, or the requested asset — SUI,
 *     USDC, MOV — has no Thetanuts book), the feed streams a deterministic
 *     simulated random walk around the cached dev IV table, clearly labeled
 *     `simulated: true`, `dataSource: "STATIC_DEV"`. It is gated to the
 *     dev/demo boundary (`allowed`) and refuses to run in `mainnet`
 *     (`ERR_MOCK_FORBIDDEN`).
 *   - Live data is never fabricated and simulated data is never presented as
 *     live — the UI badges each tick accordingly.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { ProviderDescriptor } from "@mova/types";
import { ThetanutsHedgingProvider, type ThetanutsOptions } from "./thetanuts.js";

/** Thetanuts V4 underlyings with a live book. */
export const THETANUTS_LIVE_UNDERLYINGS: readonly string[] = ["ETH", "BTC"];

/** Cached dev IV table the simulated realtime walk anchors on. */
const DEV_IV_ANCHOR: Readonly<Record<string, number>> = {
  SUI: 0.55,
  ETH: 0.6,
  BTC: 0.4,
  USDC: 0.01,
  MOV: 0.85,
  USD: 0.005,
  MYR: 0.02,
  EUR: 0.01,
  SGD: 0.01,
  HKD: 0.005,
  AED: 0.005,
};

export interface RealtimeOptionTick {
  asset: string;
  /** Implied volatility (0..1). */
  impliedVol: number;
  /** Option delta (0..1) of the picked PUT. */
  delta: number;
  /** Premium per contract (8-decimal int string) — 0 when simulated. */
  price: string;
  /** Expiry (epoch ms) of the picked contract — 0 when simulated. */
  expiry: number;
  simulated: boolean;
  dataSource: "LIVE" | "STATIC_DEV";
  /** Epoch ms of the tick. */
  at: number;
}

export interface RealtimeOptionFeed {
  readonly descriptor: ProviderDescriptor;
  /** Start streaming; returns an unsubscribe. Emits one tick immediately. */
  subscribe(onTick: (tick: RealtimeOptionTick) => void): () => void;
}

export interface ThetanutsRealtimeOptions {
  /** Underlyings to stream (defaults to the live list + SUI for the demo). */
  underlyings?: string[];
  /** Poll interval in ms (default 8000). */
  intervalMs?: number;
  /** Live OptionBook config — when absent, every tick is the simulated walk. */
  live?: ThetanutsOptions;
  /** Dev/demo gate for the simulated fallback (false in mainnet → refuse). */
  allowed: boolean;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable RNG (0..1) for a deterministic simulated walk. */
  random?: () => number;
}

/**
 * Realtime Thetanuts OptionBook feed. Tries the live provider per underlying;
 * falls back to a labeled simulated walk on any failure. `subscribe()` is
 * idempotent-safe and returns an unsubscribe.
 */
export class ThetanutsRealtimeFeed implements RealtimeOptionFeed {
  readonly descriptor: ProviderDescriptor = {
    kind: "REAL",
    name: "THETANUTS_V4_REALTIME",
    network: null,
  };

  private readonly underlyings: string[];
  private readonly intervalMs: number;
  private readonly allowed: boolean;
  private readonly liveProvider: ThetanutsHedgingProvider | null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly walkState: Map<string, number> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private subscribers = 0;
  /** Last live-feed failure, surfaced for honesty in the UI. */
  lastLiveError: string | null = null;

  constructor(options: ThetanutsRealtimeOptions) {
    this.underlyings = options.underlyings ?? [...THETANUTS_LIVE_UNDERLYINGS, "SUI"];
    this.intervalMs = options.intervalMs ?? 8000;
    this.allowed = options.allowed;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.liveProvider = options.live ? new ThetanutsHedgingProvider(options.live) : null;
  }

  private assertAllowed(): void {
    if (!this.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "ThetanutsRealtimeFeed simulated fallback is not permitted in this runtime boundary (mainnet)",
      );
    }
  }

  /** One simulated tick: bounded random walk around the dev IV anchor. */
  private simulatedTick(asset: string): RealtimeOptionTick {
    const anchor = DEV_IV_ANCHOR[asset] ?? 0.5;
    const prev = this.walkState.get(asset) ?? anchor;
    // Mean-reverting ±4% per tick — small enough to look like a live book.
    const next = Math.min(0.99, Math.max(0.005, prev + (this.random() - 0.5) * 0.04 * anchor + (anchor - prev) * 0.1));
    this.walkState.set(asset, next);
    return {
      asset,
      impliedVol: Number(next.toFixed(4)),
      delta: Number((0.5 + (this.random() - 0.5) * 0.2).toFixed(3)),
      price: "0",
      expiry: 0,
      simulated: true,
      dataSource: "STATIC_DEV",
      at: this.now(),
    };
  }

  private async tickOnce(emit: (tick: RealtimeOptionTick) => void): Promise<void> {
    for (const asset of this.underlyings) {
      const liveSupported = THETANUTS_LIVE_UNDERLYINGS.includes(asset);
      if (this.liveProvider && liveSupported) {
        try {
          const snap = await this.liveProvider.getVolatility({
            asset,
            horizonDays: 7,
            confidenceLevel: 0.95,
          });
          const best = await this.liveProvider.quote({
            asset,
            amount: { asset: "USDC", amount: "100000000" }, // $100 notional for the quote
            strategy: "PUT_OPTION",
            durationDays: 7,
          });
          this.lastLiveError = null;
          emit({
            asset,
            impliedVol: best.impliedVol ?? snap.annualizedVol,
            delta: best.delta ?? 0.5,
            price: best.premium.amount,
            expiry: best.validUntil,
            simulated: false,
            dataSource: "LIVE",
            at: this.now(),
          });
          continue;
        } catch (err) {
          this.lastLiveError = err instanceof Error ? err.message : String(err);
        }
      }
      // No live book for this asset (or the live call failed) → honest simulated tick.
      emit(this.simulatedTick(asset));
    }
  }

  subscribe(onTick: (tick: RealtimeOptionTick) => void): () => void {
    this.assertAllowed();
    this.subscribers += 1;
    // Emit immediately so the panel never waits a full interval.
    void this.tickOnce(onTick);
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tickOnce(onTick);
      }, this.intervalMs);
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.subscribers -= 1;
      if (this.subscribers <= 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }
}
