/**
 * REAL MOVA-owned PTB settlement demo (testnet).
 *
 * Builds ONE programmable transaction block that BOTH:
 *   1. transfers native SUI to the recipient, AND
 *   2. mints the on-chain `OwnedPaymentRecord` (mova_owned::record_payment)
 *      owned by the sender — atomically, in a single user-signed transaction.
 *
 * Submits through `SuiSettlementProvider` (@mova/integrations, now supporting
 * kind "MOVA_OWNED_TRANSFER") and reports the REAL testnet digest.
 * `simulated: false` — this is a real on-chain transaction, not a mock.
 *
 * Usage:
 *   npx tsx scripts/settle-ptb.ts [amount-in-SUI] [recipient]
 *   (defaults: 0.1 SUI -> demo Alice address)
 *
 * Requires in `.env`: SUI_PRIVATE_KEY + MOVA_PACKAGE_ID (published package).
 * Safety: all fields are explicit + validated here; the AI never contributes.
 */
import {
  SuiSettlementProvider,
  type MovaOwnedTransferPayload,
} from "@mova/integrations";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
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
  if (!env.MOVA_PACKAGE_ID) throw new Error("MOVA_PACKAGE_ID missing in .env — required for the MOVA-owned PTB (see verify-publish.ts)");

  const amountSui = process.argv[2] ?? "0.1";
  const recipient =
    process.argv[3] ?? "0xa11ce00000000000000000000000000000000000000000000000000000000000"; // demo Alice

  const { secretKey } = decodeSuiPrivateKey(env.SUI_PRIVATE_KEY);
  const signer = Ed25519Keypair.fromSecretKey(secretKey);
  const from = signer.getPublicKey().toSuiAddress();

  const payload: MovaOwnedTransferPayload = {
    kind: "MOVA_OWNED_TRANSFER",
    from,
    to: recipient,
    amount: toMist(amountSui),
    asset: "SUI",
    movaPackageId: env.MOVA_PACKAGE_ID,
    record: {
      correlationId: `ptb-${Date.now()}`,
      rawText: `Pay ${amountSui} SUI to ${recipient}`,
      amountMist: toMist(amountSui),
      asset: "SUI",
      recipient,
      network: NETWORK,
      state: "SETTLED",
      createdAtMs: Date.now(),
    },
  };

  console.log("== REAL MOVA-OWNED PTB (testnet) ==");
  console.log(`from      : ${from}`);
  console.log(`to        : ${recipient}`);
  console.log(`amount    : ${amountSui} SUI (${payload.amount} MIST)`);
  console.log(`package   : ${payload.movaPackageId}`);
  console.log(`commands  : splitCoins → transferObjects → mova_owned::record_payment`);
  console.log("----------------------------------------");

  const provider = new SuiSettlementProvider({ network: NETWORK, rpcUrl: RPC_URL, signer });
  const outcome = await provider.submit({ network: NETWORK, payload });

  console.log("outcome   :", JSON.stringify(outcome, null, 2));
  console.log("----------------------------------------");

  if (!outcome.ok || !outcome.txDigest) {
    console.error("REAL PTB FAILED — no digest produced. See outcome above.");
    process.exit(1);
  }

  console.log("✅ REAL TESTNET DIGEST (simulated=false):", outcome.txDigest);
  console.log("   explorer: https://suiscan.xyz/testnet/tx/" + outcome.txDigest);
  console.log(
    "   NOTE: this single PTB also minted the on-chain OwnedPaymentRecord (mova_owned::record_payment) owned by the sender.",
  );

  // Honest audit line (append-only style, simulated=false).
  console.log(
    JSON.stringify({
      event: "SETTLED",
      kind: "MOVA_OWNED_TRANSFER",
      simulated: false,
      txDigest: outcome.txDigest,
      network: NETWORK,
      from,
      to: recipient,
      amountMist: payload.amount,
      asset: payload.asset,
      package: payload.movaPackageId,
      status: outcome.status,
      timestamp: Date.now(),
    }),
  );
}

main().catch((e) => {
  console.error("REAL PTB FAILED:", e?.message ?? e);
  process.exit(1);
});
