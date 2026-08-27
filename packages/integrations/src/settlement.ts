/**
 * Settlement providers — the ONLY path that settles money on-chain.
 *
 * Contract:
 * - `submit()` receives EXPLICIT, already-validated execution params (never LLM
 *   output) and returns a structured outcome.
 * - A real implementation (Sui, `@mysten/sui`) returns a real `txDigest`.
 * - The simulated implementation NEVER fabricates a digest. It returns
 *   `simulated: true`, `txDigest: null`, and the audit trail records the
 *   settlement as SIMULATED. This is a mock, not a fake transaction.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { Network, ProviderDescriptor, TransactionStatus } from "@mova/types";

export interface SubmitParams {
  network: Network;
  /** Explicit, validated execution params (built by ExecutionService). */
  payload: unknown;
}

export interface SettlementOutcome {
  ok: boolean;
  simulated: boolean;
  /** Real Sui digest. NULL in simulation mode. */
  txDigest: string | null;
  status: TransactionStatus;
  error: string | null;
  details: Record<string, unknown>;
}

export interface SettlementProvider {
  readonly descriptor: ProviderDescriptor;
  submit(params: SubmitParams): Promise<SettlementOutcome>;
  getStatus(txDigest: string): Promise<SettlementOutcome>;
}

export interface SimulatedSettlementOptions {
  /** Fail closed when mocks are not permitted (e.g. mainnet). */
  allowed: boolean;
}

/**
 * Deterministic mock. Does NOT touch a chain and does NOT emit a digest.
 * Only usable when mocks are permitted by the runtime boundary.
 */
export class SimulatedSettlementProvider implements SettlementProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "MOCK",
    name: "SIMULATED_SUI",
    network: null,
  };

  constructor(private readonly options: SimulatedSettlementOptions) {}

  private assertAllowed(): void {
    if (!this.options.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "SimulatedSettlementProvider is not permitted in this runtime boundary",
      );
    }
  }

  async submit(params: SubmitParams): Promise<SettlementOutcome> {
    this.assertAllowed();
    return {
      ok: true,
      simulated: true,
      txDigest: null, // never fabricate a digest
      status: "SIMULATED",
      error: null,
      details: {
        network: params.network,
        note: "SIMULATED settlement — no chain interaction, no real transaction occurred.",
      },
    };
  }

  async getStatus(_txDigest: string): Promise<SettlementOutcome> {
    this.assertAllowed();
    return {
      ok: false,
      simulated: true,
      txDigest: null,
      status: "FAILED",
      error: "Simulated settlement has no digest to query",
      details: {},
    };
  }
}
