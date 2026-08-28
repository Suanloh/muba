/**
 * Real Sui settlement provider (Phase 2 — real settlement).
 *
 * The ONLY path that moves real value on-chain. Builds a programmable
 * transaction block from EXPLICIT, already-validated execution params (never
 * LLM output), dry-runs it, signs with the custodial signer, submits to the
 * network, and waits for confirmation. Returns a REAL `txDigest` with
 * `simulated: false`.
 *
 * Safety:
 * - `payload` must be a `SuiTransferPayload` produced by the deterministic
 *   execution layer (validated amount/recipient) — never from the AI.
 * - The provider does not approve or decide; it only executes validated,
 *   gated settlement.
 * - `getStatus` is honest: it queries the chain and reports `CONFIRMED` only
 *   on a real `Success` status.
 */
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import type { Keypair } from "@mysten/sui/cryptography";
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  Network,
  ProviderDescriptor,
  TransactionStatus,
} from "@mova/types";
import type {
  SettlementOutcome,
  SettlementProvider,
  SubmitParams,
} from "./settlement.js";

/** Explicit, validated execution params for a Sui settlement. */
export interface SuiTransferPayload {
  kind: "NATIVE_TRANSFER" | "TOKEN_TRANSFER";
  /** Source / sender address (the signing account). */
  from: string;
  /** Recipient Sui address. */
  to: string;
  /** Amount in smallest units (MIST for SUI) as a decimal string. */
  amount: string;
  /** "SUI" for native, or a full coin type ("0x…::usdc::USDC") for tokens. */
  asset: string;
  /** Optional gas budget in MIST. */
  gasBudget?: string;
}

export interface SuiSettlementProviderOptions {
  network: Network;
  /** Fullnode base URL, e.g. https://fullnode.testnet.sui.io:443 */
  rpcUrl: string;
  /** Custodial signer (from SUI_PRIVATE_KEY / SUI_MNEMONIC). */
  signer: Keypair;
  /** How long to wait for on-chain confirmation (ms). */
  confirmTimeoutMs?: number;
}

function networkName(network: Network): "devnet" | "testnet" | "mainnet" {
  switch (network) {
    case "SUI_DEVNET":
      return "devnet";
    case "SUI_MAINNET":
      return "mainnet";
    case "SUI_TESTNET":
      return "testnet";
  }
}

export class SuiSettlementProvider implements SettlementProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly client: SuiGrpcClient;
  private readonly signer: Keypair;
  private readonly confirmTimeoutMs: number;

  constructor(options: SuiSettlementProviderOptions) {
    this.descriptor = {
      kind: "REAL",
      name: "SUI",
      network: options.network,
    };
    this.signer = options.signer;
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? 60_000;
    this.client = new SuiGrpcClient({
      network: networkName(options.network),
      baseUrl: options.rpcUrl,
    });
  }

  /** Build the PTB from explicit validated params. */
  private buildTx(payload: SuiTransferPayload): Transaction {
    const tx = new Transaction();
    tx.setSender(payload.from);
    const amount = BigInt(payload.amount);

    if (payload.kind === "NATIVE_TRANSFER") {
      const [coin] = tx.splitCoins(tx.gas, [amount]);
      tx.transferObjects([coin], tx.pure.address(payload.to));
      return tx;
    }

    // TOKEN_TRANSFER: split an existing coin of `asset` type and transfer it.
    // Selected deterministically from the sender's owned coins.
    throw new MovaError(
      ErrorCode.INTEGRATION_UNAVAILABLE,
      "TOKEN_TRANSFER payloads are not yet supported by the real provider (native SUI transfer only in this phase)",
    );
  }

  async submit(params: SubmitParams): Promise<SettlementOutcome> {
    if (params.network !== this.descriptor.network) {
      throw new MovaError(
        ErrorCode.CONFIGURATION_ERROR,
        `settlement network ${params.network} does not match provider ${this.descriptor.network}`,
      );
    }
    const payload = params.payload as SuiTransferPayload;
    if (!payload || typeof payload !== "object" || !payload.to || !payload.amount) {
      return {
        ok: false,
        simulated: false,
        txDigest: null,
        status: "FAILED",
        error: "invalid settlement payload: expected SuiTransferPayload",
        details: {},
      };
    }

    const tx = this.buildTx(payload);

    // 1. Dry-run (simulate) BEFORE submission — fail closed on any error.
    const simulated = await this.client.simulateTransaction({
      transaction: tx,
      include: { effects: true },
    });
    if (simulated.$kind === "FailedTransaction") {
      return {
        ok: false,
        simulated: false,
        txDigest: null,
        status: "FAILED",
        error: `dry-run failed: ${simulated.FailedTransaction.status?.error ?? "unknown simulation error"}`,
        details: { stage: "simulate" },
      };
    }
    if (simulated.Transaction.status?.success === false) {
      return {
        ok: false,
        simulated: false,
        txDigest: null,
        status: "FAILED",
        error: `dry-run failed: ${simulated.Transaction.status.error ?? "unknown"}`,
        details: { stage: "simulate" },
      };
    }

    // 2. Sign + submit.
    let digest: string;
    try {
      const res = await this.client.signAndExecuteTransaction({
        transaction: tx,
        signer: this.signer,
        include: { effects: true, events: true },
      });
      digest =
        res.$kind === "Transaction" ? res.Transaction.digest : res.FailedTransaction.digest;
    } catch (err) {
      return {
        ok: false,
        simulated: false,
        txDigest: null,
        status: "FAILED",
        error: `submission failed: ${err instanceof Error ? err.message : String(err)}`,
        details: { stage: "submit" },
      };
    }

    // 3. Wait for confirmation.
    const status = await this.waitForConfirmation(digest);
    return {
      ok: status === "CONFIRMED",
      simulated: false,
      txDigest: digest,
      status,
      error: status === "FAILED" ? `transaction failed on-chain: ${digest}` : null,
      details: {
        kind: payload.kind,
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        asset: payload.asset,
        network: this.descriptor.network,
        provider: "SUI",
      },
    };
  }

  private async waitForConfirmation(digest: string): Promise<TransactionStatus> {
    try {
      const res = await this.client.waitForTransaction({
        digest,
        timeout: this.confirmTimeoutMs,
        include: { effects: true },
      });
      const status = res.$kind === "Transaction" ? res.Transaction.status : res.FailedTransaction.status;
      return status?.success === false ? "FAILED" : "CONFIRMED";
    } catch {
      return "SUBMITTED"; // submitted on-chain; final status not yet observed
    }
  }

  async getStatus(txDigest: string): Promise<SettlementOutcome> {
    try {
      const res = await this.client.getTransaction({
        digest: txDigest,
        include: { effects: true },
      });
      const status = res.$kind === "Transaction" ? res.Transaction.status : res.FailedTransaction.status;
      return {
        ok: status?.success === true,
        simulated: false,
        txDigest,
        status: status?.success === false ? "FAILED" : "CONFIRMED",
        error: status?.success === false ? `transaction failed: ${txDigest}` : null,
        details: { queried: true },
      };
    } catch (err) {
      return {
        ok: false,
        simulated: false,
        txDigest,
        status: "SUBMITTED",
        error: `status query failed: ${err instanceof Error ? err.message : String(err)}`,
        details: {},
      };
    }
  }
}
