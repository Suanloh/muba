/**
 * Verify that the Sui private key in `.env` owns the expected wallet address.
 *
 * Run: `npx tsx scripts/verify-sui-key.ts`
 *
 * NEVER prints the private key — only the derived (public) address and a
 * MATCH / MISMATCH verdict.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const EXPECTED_ADDRESS =
  process.env.EXPECTED_SUI_ADDRESS ??
  "0xf21cf06a0160e0cbe705391e3ebccac0c46a69d6bc48b64b973bd01e8d1e9343";

function loadEnvKey(filePath: string): string {
  const env = readFileSync(filePath, "utf8");
  const line = env.split("\n").find((l) => l.trim().startsWith("SUI_PRIVATE_KEY="));
  if (!line) {
    throw new Error("SUI_PRIVATE_KEY not found in .env");
  }
  return line.slice(line.indexOf("=") + 1).trim();
}

const secretKeyStr = loadEnvKey(fileURLToPath(new URL("../.env", import.meta.url)));
if (!secretKeyStr) {
  throw new Error("SUI_PRIVATE_KEY is empty in .env");
}

const { secretKey } = decodeSuiPrivateKey(secretKeyStr);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const derived = keypair.toSuiAddress();

console.log(`expected address: ${EXPECTED_ADDRESS}`);
console.log(`derived address : ${derived}`);
if (derived === EXPECTED_ADDRESS) {
  console.log("✓ MATCH — the key in .env owns the funded wallet.");
} else {
  console.log("✗ MISMATCH — the key in .env does NOT own the funded wallet.");
  process.exitCode = 1;
}
