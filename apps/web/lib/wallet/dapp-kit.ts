"use client";
/**
 * MOVA dApp-kit instance (current @mysten/dapp-kit-react v2 API).
 *
 * - Networks: devnet / testnet / mainnet (gRPC clients).
 * - Auto-connect enabled.
 * - Registers the dev-only Demo Wallet via `walletInitializers`.
 */
import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  DAPP_NETWORKS,
  defaultDappNetwork,
  dappNetworkRpcUrl,
  ENABLE_DEMO_WALLET,
} from "./networks.js";
import { demoWalletInitializer } from "./demo-wallet.js";

export const dAppKit = createDAppKit({
  networks: [...DAPP_NETWORKS],
  defaultNetwork: defaultDappNetwork(),
  autoConnect: true,
  createClient(network) {
    return new SuiGrpcClient({ network, baseUrl: dappNetworkRpcUrl(network) });
  },
  // MOVA shows installed wallets + its own dev Demo Wallet; the built-in
  // Slush web wallet is disabled (also avoids SSR `document` access).
  slushWalletConfig: null,
  walletInitializers: ENABLE_DEMO_WALLET ? [demoWalletInitializer] : [],
});

// Register the instance type globally so hooks are fully typed.
declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
