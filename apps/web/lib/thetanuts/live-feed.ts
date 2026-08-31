/**
 * Web singleton for the Thetanuts OptionBook realtime feed.
 *
 * Streams live (ETH/BTC) or honestly-labeled simulated (SUI etc.) option-book
 * ticks. The simulated fallback is refused on mainnet (fail closed). A live
 * book is attempted when NEXT_PUBLIC_THETANUTS_RPC is set (Base mainnet RPC);
 * otherwise every tick is the labeled simulated walk.
 */
import { ThetanutsRealtimeFeed } from "@mova/integrations";
import { MOVA_ENV } from "@/lib/wallet/networks";

const THETANUTS_RPC = (process.env.NEXT_PUBLIC_THETANUTS_RPC ?? "").trim();

export const thetanutsLiveFeed = new ThetanutsRealtimeFeed({
  // Dev/testnet: simulated fallback allowed. Mainnet: fail closed.
  allowed: MOVA_ENV !== "mainnet",
  intervalMs: 8000,
  // ETH/BTC have a real Thetanuts book; SUI demonstrates the honest
  // simulated-realtime path for a settlement asset.
  underlyings: ["ETH", "BTC", "SUI"],
  live: THETANUTS_RPC ? { rpcUrl: THETANUTS_RPC } : undefined,
});
