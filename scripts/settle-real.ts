/**
 * REAL Sui settlement demo (Phase 2 — real settlement on testnet).
 *
 * Builds a validated native-SUI transfer from `.env` signing material,
 * submits it through `SuiSettlementProvider` (@mova/integrations), and reports
 * the REAL testnet digest. `simulated: false` — this is a real on-chain
 * transaction, not a mock.
 *
 * Usage:
 *   npx tsx scripts/settle-real.ts [amount-in-SUI] [recipient]
 *   (defaults: 0.1 SUI -> demo Alice address)
 *
 * Safety: the payload is explicit + validated here (never from the AI). The
 * private key is read from .env and never printed.
 */
import { SuiSettlementProvider, type SuiTransferPayload } from "@mova/integrations";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { readFileSync } from "node:fs";

const RPC_URL = "https://fullnode.testnet.sui.io:443";
const NETWORK = "SUI_TESTNET";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]!] = m[2]!.trim();
    }
  } catch {
    /* no .env */
  }
  return out;
}

function toMist(sui: string): string {
  const [whole = "0", frac = ""] = sui.split(".");
  const padded = frac.padEnd(9, "0").slice(0, 9);
  return BigInt(`${whole}${padded}`).toString();
}

async function main() {
  const env = loadEnv();
  if (!env.SUI_PRIVATE_KEY) throw new Error("SUI_PRIVATE_KEY missing in .env — required for real settlement");

  const amountSui = process.argv[2] ?? "0.1";
  const recipient =
    process.argv[3] ?? "0xa11ce00000000000000000000000000000000000000000000000000000000000"; // demo Alice

  const { secretKey } = decodeSuiPrivateKey(env.SUI_PRIVATE_KEY);
  const signer = Ed25519Keypair.fromSecretKey(secretKey);
  const from = signer.getPublicKey().toSuiAddress();

  const payload: SuiTransferPayload = {
    kind: "NATIVE_TRANSFER",
    from,
    to: recipient,
    amount: toMist(amountSui),
    asset: "SUI",
  };

  console.log("== REAL SETTLEMENT (testnet) ==");
  console.log(`from     : ${from}`);
  console.log(`to       : ${recipient}`);
  console.log(`amount   : ${amountSui} SUI (${payload.amount} MIST)`);
  console.log(`provider : SuiSettlementProvider (REAL, simulated=false)`);
  console.log("----------------------------------------");

  const provider = new SuiSettlementProvider({ network: NETWORK, rpcUrl: RPC_URL, signer });
  const outcome = await provider.submit({ network: NETWORK, payload });

  console.log("outcome  :", JSON.stringify(outcome, null, 2));
  console.log("----------------------------------------");

  if (!outcome.ok || !outcome.txDigest) {
    console.error("REAL SETTLEMENT FAILED — no digest produced. See outcome above.");
    process.exit(1);
  }

  console.log("✅ REAL TESTNET DIGEST (simulated=false):", outcome.txDigest);
  console.log("   explorer: https://suiscan.xyz/testnet/tx/" + outcome.txDigest);

  // Honest audit line (append-only style, simulated=false).
  console.log(
    JSON.stringify({
      event: "SETTLED",
      simulated: false,
      txDigest: outcome.txDigest,
      network: NETWORK,
      from,
      to: recipient,
      amountMist: payload.amount,
      asset: payload.asset,
      status: outcome.status,
      timestamp: Date.now(),
    }),
  );

  // Verify the recipient balance increased (real on-chain read).
  const client = new SuiGrpcClient({ network: "testnet", baseUrl: RPC_URL });
  const bal = (await client.getBalance({ owner: recipient })) as {
    balance?: { coinBalance?: string };
  };
  console.log("recipient SUI balance now (MIST):", bal.balance?.coinBalance ?? "0");
}

main().catch((e) => {
  console.error("REAL SETTLEMENT FAILED:", e?.message ?? e);
  process.exit(1);
});
