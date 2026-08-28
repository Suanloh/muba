/**
 * Verify the MOVA Move package publish (Phase 2 → resolved).
 *
 * Confirms that the `MOVA_PACKAGE_ID` in `.env` matches the address recorded
 * in `contracts/mova/Published.toml` (`published-at` / `original-id`) so the
 * deployed package is never confused with a stale or fabricated address.
 *
 * Run: `npx tsx scripts/verify-publish.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readEnvValue(filePath: string, key: string): string {
  try {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1]!.trim();
    }
  } catch {
    /* missing file */
  }
  return "";
}

function readPublishedTomlValue(filePath: string, key: string): string {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`));
    if (m) return m[1]!.trim();
  }
  return "";
}

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = `${root}.env`;
const tomlPath = `${root}contracts/mova/Published.toml`;

const envPackage = readEnvValue(envPath, "MOVA_PACKAGE_ID");
const publishedAt = readPublishedTomlValue(tomlPath, "published-at");
const originalId = readPublishedTomlValue(tomlPath, "original-id");
const chainId = readPublishedTomlValue(tomlPath, "chain-id");

console.log("== MOVA MOVE PACKAGE PUBLISH ==");
console.log(`.env MOVA_PACKAGE_ID   : ${envPackage || "(empty)"}`);
console.log(`Published.toml          : ${tomlPath}`);
console.log(`  chain-id              : ${chainId || "(unknown)"}`);
console.log(`  published-at          : ${publishedAt || "(missing)"}`);
console.log(`  original-id           : ${originalId || "(missing)"}`);
console.log("----------------------------------------");

if (!envPackage) {
  console.error("✗ MOVA_PACKAGE_ID is EMPTY in .env — publish resolution is missing.");
  process.exit(1);
}
if (!publishedAt || !originalId) {
  console.error("✗ Published.toml is missing published-at/original-id — run `sui client publish`.");
  process.exit(1);
}
if (envPackage !== publishedAt || envPackage !== originalId) {
  console.error("✗ MISMATCH — .env MOVA_PACKAGE_ID does not match the published package address.");
  process.exit(1);
}

console.log(`✓ MATCH — MOVA_PACKAGE_ID resolves to the on-chain published package (${chainId || "testnet"}).`);
