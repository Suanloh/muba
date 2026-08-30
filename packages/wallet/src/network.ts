/**
 * Sui network handling — mapping between wallet chain ids ("sui:testnet"),
 * MOVA `Network` values, and the runtime boundary from `@mova/config`.
 *
 * Deterministic and framework-agnostic. The web adapter feeds the wallet's
 * reported chain id in and renders the resulting `MovaNetworkState`.
 */
import { NETWORK_BOUNDARIES, type RuntimeEnv } from "@mova/config";
import type { Network } from "@mova/types";
import type { MovaNetworkState } from "./types.js";

export interface SuiNetworkDefinition {
  /** Wallet-standard chain id. */
  chain: string;
  network: Network;
  rpcUrl: string;
  label: string;
  /** devnet faucet available for funding. */
  supportsFaucet: boolean;
}

/** Canonical Sui networks MOVA recognizes. */
export const SUI_NETWORKS: readonly SuiNetworkDefinition[] = [
  {
    chain: "sui:devnet",
    network: "SUI_DEVNET",
    rpcUrl: "https://fullnode.devnet.sui.io:443",
    label: "Devnet",
    supportsFaucet: true,
  },
  {
    chain: "sui:testnet",
    network: "SUI_TESTNET",
    rpcUrl: "https://fullnode.testnet.sui.io:443",
    label: "Testnet",
    supportsFaucet: true,
  },
  {
    chain: "sui:mainnet",
    network: "SUI_MAINNET",
    rpcUrl: "https://fullnode.mainnet.sui.io:443",
    label: "Mainnet",
    supportsFaucet: false,
  },
] as const;

export function networkForChain(chain: string | null | undefined): Network | null {
  if (!chain) return null;
  return SUI_NETWORKS.find((n) => n.chain === chain)?.network ?? null;
}

export function chainForNetwork(network: Network): string {
  const def = SUI_NETWORKS.find((n) => n.network === network);
  if (!def) {
    throw new Error(`no Sui chain mapping for network ${network}`);
  }
  return def.chain;
}

export function networkLabel(network: Network): string {
  const def = SUI_NETWORKS.find((n) => n.network === network);
  return def?.label ?? network;
}

export function networkDefinition(
  network: Network,
): SuiNetworkDefinition | undefined {
  return SUI_NETWORKS.find((n) => n.network === network);
}

/** Expected MOVA network for a runtime boundary (dev → devnet, etc.). */
export function expectedNetworkForEnv(env: RuntimeEnv): Network {
  const boundary = NETWORK_BOUNDARIES[env];
  if (!boundary) {
    throw new Error(
      `invalid MOVA env "${env}" — expected one of: dev, testnet, mainnet`,
    );
  }
  return boundary.network;
}

/**
 * Build the wallet-vs-MOVA network state from a wallet-reported chain id.
 * `expected` is the MOVA runtime network (e.g. SUI_TESTNET).
 */
export function resolveNetworkState(
  expected: Network,
  detectedChain: string | null,
): MovaNetworkState {
  const detectedNetwork = networkForChain(detectedChain);
  const unknown = detectedChain === null || detectedNetwork === null;
  const matches = !unknown && detectedNetwork === expected;
  return {
    expected,
    detectedChain,
    detectedNetwork,
    matches,
    unknown,
  };
}
