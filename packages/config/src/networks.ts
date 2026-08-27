/**
 * Dev / testnet / mainnet configuration boundaries.
 *
 * `MOVA_ENV` selects the runtime boundary. Each boundary pins the Sui network,
 * mock policy, and settlement mode. Violations FAIL CLOSED at boot (throw) —
 * a misconfigured "mainnet" with mocks enabled must never start.
 */
import type { Network, SettlementMode } from "@mova/types";

export type RuntimeEnv = "dev" | "testnet" | "mainnet";

export interface NetworkBoundary {
  env: RuntimeEnv;
  network: Network;
  /** Mock providers allowed in this boundary. */
  allowsMocks: boolean;
  /** Settlement must be real (no simulated settlement). */
  requiresRealSettlement: boolean;
  /** devnet faucet available for funding. */
  supportsFaucet: boolean;
  description: string;
}

export const NETWORK_BOUNDARIES: Readonly<Record<RuntimeEnv, NetworkBoundary>> = {
  dev: {
    env: "dev",
    network: "SUI_DEVNET",
    allowsMocks: true,
    requiresRealSettlement: false,
    supportsFaucet: true,
    description: "Local dev: Sui devnet, mocks on, no real money.",
  },
  testnet: {
    env: "testnet",
    network: "SUI_TESTNET",
    allowsMocks: true,
    requiresRealSettlement: false,
    supportsFaucet: false,
    description: "Staging: Sui testnet, test tokens, real gates and policy.",
  },
  mainnet: {
    env: "mainnet",
    network: "SUI_MAINNET",
    allowsMocks: false,
    requiresRealSettlement: true,
    supportsFaucet: false,
    description: "Production: Sui mainnet, REAL funds, mocks forbidden.",
  },
};

export interface BoundaryError {
  violations: string[];
}

/**
 * Enforce the boundary for the parsed env. Returns violations (empty when OK).
 * Fail-closed: any violation means the process must not start.
 */
export function checkBoundary(
  env: RuntimeEnv,
  opts: { settlementMode: SettlementMode; useMocks: boolean; suiNetwork: string },
): BoundaryError {
  const boundary = NETWORK_BOUNDARIES[env];
  const violations: string[] = [];

  if (opts.suiNetwork !== boundary.network) {
    violations.push(
      `SUI_NETWORK=${opts.suiNetwork} does not match MOVA_ENV=${env} (expected ${boundary.network})`,
    );
  }
  if (boundary.requiresRealSettlement && opts.settlementMode !== "real") {
    violations.push(
      `MOVA_ENV=${env} requires SETTLEMENT_MODE=real (got ${opts.settlementMode})`,
    );
  }
  if (!boundary.allowsMocks && opts.useMocks) {
    violations.push(`MOVA_ENV=${env} forbids USE_MOCKS=true`);
  }

  return { violations };
}
