/**
 * Counterparty screening providers — sanctions / watchlist checks.
 *
 * Deterministic matching only (the LLM never screens). The mock uses a small,
 * versioned simulated list and marks results `simulated: true`. A real
 * integration (e.g. a sanctions-data vendor) swaps in behind the same interface.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { ProviderDescriptor, ScreeningDecision } from "@mova/types";

export interface ScreenRequest {
  name: string | null;
  /** Address / account identifier. */
  identifier: string | null;
}

export interface ScreenResult {
  decision: ScreeningDecision;
  matchedLists: string[];
  /** Deterministic 0..100 score. */
  score: number;
  /** Versioned source list used. */
  listVersion: string;
  simulated: boolean;
}

export interface ScreeningProvider {
  readonly descriptor: ProviderDescriptor;
  screen(request: ScreenRequest): Promise<ScreenResult>;
}

export interface MockScreeningOptions {
  allowed: boolean;
  /** Simulated watchlist entries: { name?, identifier? } — a HIT matches any field. */
  watchlist?: Array<{ name: string | null; identifier: string | null }>;
}

const DEFAULT_WATCHLIST: Array<{ name: string | null; identifier: string | null }> = [
  { name: "SIMULATED SANCTIONED ENTITY", identifier: null },
  { name: null, identifier: "0x00000000000000000000000000000000000000dEaD" },
];

const LIST_VERSION = "sim-2026.08.27";

/**
 * Deterministic mock: exact (case-insensitive) match against a simulated list.
 * Ambiguous/unknown data → REVIEW (never CLEAR on uncertainty).
 */
export class MockScreeningProvider implements ScreeningProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "MOCK",
    name: "SIMULATED_SCREENING",
    network: null,
  };

  constructor(private readonly options: MockScreeningOptions) {}

  private assertAllowed(): void {
    if (!this.options.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "MockScreeningProvider is not permitted in this runtime boundary",
      );
    }
  }

  async screen(request: ScreenRequest): Promise<ScreenResult> {
    this.assertAllowed();
    const list = this.options.watchlist ?? DEFAULT_WATCHLIST;
    const normalized = (s: string | null): string => (s ?? "").trim().toLowerCase();

    const hits = list.filter((entry) => {
      if (entry.name && request.name && normalized(entry.name) === normalized(request.name)) {
        return true;
      }
      return Boolean(
        entry.identifier && request.identifier && normalized(entry.identifier) === normalized(request.identifier),
      );
    });

    if (hits.length > 0) {
      return {
        decision: "HIT",
        matchedLists: hits.map((h) => h.name ?? h.identifier ?? "unknown"),
        score: 100,
        listVersion: LIST_VERSION,
        simulated: true,
      };
    }

    // No identifiers at all => cannot clear with confidence.
    if (!request.name && !request.identifier) {
      return {
        decision: "REVIEW",
        matchedLists: [],
        score: 40,
        listVersion: LIST_VERSION,
        simulated: true,
      };
    }

    return {
      decision: "CLEAR",
      matchedLists: [],
      score: 0,
      listVersion: LIST_VERSION,
      simulated: true,
    };
  }
}
