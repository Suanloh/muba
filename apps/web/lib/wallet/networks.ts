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

const VALID_MOVA_ENVS: readonly string[] = ["dev", "testnet", "mainnet"];

/**
 * Resolve the MOVA runtime boundary from NEXT_PUBLIC_MOVA_ENV.
 * Any unset, blank, or unknown value safely falls back to "testnet" so a
 * misconfigured/empty env var can never break the production build or the
 * `/_not-found` prerender (which evaluates this module at load time).
 */
function resolveMovaEnv(raw: string | undefined): RuntimeEnv {
  return VALID_MOVA_ENVS.includes(raw ?? "") ? (raw as RuntimeEnv) : "testnet";
}

export const MOVA_ENV: RuntimeEnv = resolveMovaEnv(process.env.NEXT_PUBLIC_MOVA_ENV);

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

/** Published MOVA `mova_owned` package on Sui testnet (from Published.toml). */
const PUBLISHED_MOVA_PACKAGE_TESTNET =
  "0x2baa7a782929b0b2af8cbbfeb20d7f75ac89db18103ae9f2e029858156ea55c2";

/**
 * MOVA Move package id for the current runtime. An explicit
 * NEXT_PUBLIC_MOVA_PACKAGE_ID wins; on testnet we default to the REAL published
 * package (verified by scripts/verify-publish.ts). Empty elsewhere → the plain
 * transfer PTB is used (no on-chain record mint).
 */
export const MOVA_PACKAGE_ID: string =
  (process.env.NEXT_PUBLIC_MOVA_PACKAGE_ID ?? "").trim() ||
  (MOVA_ENV === "testnet" ? PUBLISHED_MOVA_PACKAGE_TESTNET : "");

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
