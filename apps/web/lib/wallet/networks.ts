/**
 * MOVA web network configuration.
 *
 * Maps the MOVA runtime boundary (NEXT_PUBLIC_MOVA_ENV) to the expected Sui
 * network, and provides the dApp-kit network list + RPC URLs. No secrets here.
 */
import type { RuntimeEnv } from "@mova/config";
import type { Network } from "@mova/types";
import {
  chainForNetwork,
  expectedNetworkForEnv,
  networkDefinition,
} from "@mova/wallet";

export const MOVA_ENV: RuntimeEnv =
  (process.env.NEXT_PUBLIC_MOVA_ENV as RuntimeEnv | undefined) ?? "testnet";

/** Expected MOVA network (SUI_DEVNET | SUI_TESTNET | SUI_MAINNET). */
export const EXPECTED_NETWORK: Network = expectedNetworkForEnv(MOVA_ENV);

/** Wallet-standard chain id for the expected network, e.g. "sui:testnet". */
export const EXPECTED_CHAIN = chainForNetwork(EXPECTED_NETWORK);

export const DAPP_NETWORKS = ["devnet", "testnet", "mainnet"] as const;
export type DappNetwork = (typeof DAPP_NETWORKS)[number];

export function dappNetworkToMova(network: DappNetwork): Network {
  switch (network) {
    case "devnet":
      return "SUI_DEVNET";
    case "testnet":
      return "SUI_TESTNET";
    case "mainnet":
      return "SUI_MAINNET";
  }
}

export function dappNetworkRpcUrl(network: DappNetwork): string {
  const def = networkDefinition(dappNetworkToMova(network));
  return def?.rpcUrl ?? `https://fullnode.${network}.sui.io:443`;
}

export function defaultDappNetwork(): DappNetwork {
  return MOVA_ENV === "dev" ? "devnet" : MOVA_ENV === "mainnet" ? "mainnet" : "testnet";
}

export const ENABLE_DEMO_WALLET =
  (process.env.NEXT_PUBLIC_ENABLE_DEMO_WALLET ?? "true") === "true";

/**
 * Web settlement mode:
 * - "simulated" (default) — deterministic browser demo. Every payment reaches
 *   SETTLED with a receipt + audit trail and is clearly labeled "simulated
 *   (no value moves)"; no digest is ever fabricated.
 * - "real" — attempts a REAL on-chain settlement through the connected wallet;
 *   falls back to simulated (with the reason recorded) when the wallet can't
 *   submit (e.g. no testnet gas). Use a funded testnet wallet. Real testnet
 *   settlement is always provable via `npx tsx scripts/settle-real.ts`.
 * Set NEXT_PUBLIC_SETTLEMENT_MODE=real (in apps/web/.env.local) to opt in.
 */
export const WEB_SETTLEMENT_MODE: "simulated" | "real" =
  process.env.NEXT_PUBLIC_SETTLEMENT_MODE === "real" ? "real" : "simulated";
