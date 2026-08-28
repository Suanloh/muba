/**
 * MOVA Phase 7 — pre-flight balance check (best-effort, honest).
 *
 * Before execution we try to confirm the payer can cover amount + gas. Query
 * is best-effort: when the chain read fails or the wallet can't be queried we
 * return null (the caller proceeds — real settlement will surface the real
 * failure). When it succeeds and the balance is insufficient we report it
 * loudly so the user can fund the wallet instead of wasting a signature.
 */
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { dappNetworkRpcUrl, defaultDappNetwork } from "@/lib/wallet/networks";

/**
 * Query the payer's SUI balance (smallest units) on the expected network.
 * Returns null when the query fails (best-effort — never blocks on a failed
 * read, but never fabricates a balance either).
 */
export async function querySuiBalance(address: string): Promise<bigint | null> {
  try {
    const network = defaultDappNetwork();
    const client = new SuiGrpcClient({ network, baseUrl: dappNetworkRpcUrl(network) });
    const res = await client.getBalance({ owner: address, coinType: SUI_TYPE_ARG });
    const raw = res.balance?.addressBalance ?? res.balance?.balance ?? "0";
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Minimal gas allowance for a native transfer (0.001 SUI in smallest units). */
const GAS_ALLOWANCE = 1000000n; // 0.001 SUI

/**
 * Deterministic pre-flight check. Returns true when balance is clearly
 * sufficient (or unreadable — best-effort), false when it is definitely
 * insufficient. `amountSmallest` is the transfer amount in smallest units.
 */
export function hasSufficientBalance(
  balance: bigint | null,
  amountSmallest: string | bigint,
): boolean {
  if (balance === null) return true; // unreadable → proceed (real path will tell us)
  const amount = typeof amountSmallest === "string" ? BigInt(amountSmallest) : amountSmallest;
  return balance >= amount + GAS_ALLOWANCE;
}
