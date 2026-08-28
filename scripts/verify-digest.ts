/** Verify a real settlement digest on testnet (independent on-chain read). */
import { SuiGrpcClient } from "@mysten/sui/grpc";

const DIGEST = process.argv[2] ?? "DTVFP8Q7P4VKv3FCgLwLtaDSYc9ed49rWWwQT7DVrijc";

const client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });
const res = await client.getTransaction({ digest: DIGEST, include: { effects: true } });
const t = res.$kind === "Transaction" ? res.Transaction : res.FailedTransaction;
console.log("kind  :", res.$kind);
console.log("digest:", t.digest);
console.log("status:", JSON.stringify(t.status));
console.log("explorer: https://suiscan.xyz/testnet/tx/" + DIGEST);
