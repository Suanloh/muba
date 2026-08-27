/**
 * MOVA wallet provider abstraction.
 *
 * Adapters (e.g. the `@mysten/dapp-kit` adapter in `apps/web`) implement this
 * interface. The contract is deliberately small and safety-first:
 *
 * - `signPersonalMessage` is the ONLY signing primitive Phase 1 needs (it does
 *   not move value — used for ownership proofs / wallet authz).
 * - `submitGatedTransaction` exists so Phase 2 real settlement has a single,
 *   gate-enforced submission path. Adapters MUST require a passing
 *   `WalletExecutionGate` verdict before signing/building/submitting, and they
 *   never auto-execute arbitrary (AI-generated) transactions.
 */
import type {
  GatedTransactionRequest,
  GatedTransactionResult,
  SignatureResult,
  WalletAccount,
} from "./types.js";

export interface MovaWalletProvider {
  /** Provider name, e.g. "Sui Wallet", "Demo Wallet". */
  readonly name: string;
  connect(): Promise<WalletAccount>;
  disconnect(): Promise<void>;
  /** Currently connected account, or null. */
  getAccount(): WalletAccount | null;
  /** Currently active chain id (e.g. "sui:testnet"), or null. */
  getChainId(): string | null;
  /** Best-effort chain switch; false when the wallet does not support it. */
  switchChain(chain: string): Promise<boolean>;
  /**
   * Non-value-moving signature. Used for ownership proofs and as the Phase 1
   * stand-in for wallet authz. The wallet user must approve the signature.
   */
  signPersonalMessage(message: string): Promise<SignatureResult>;
  /**
   * Submit a FULLY GATED transaction. The `gateVerdict` must be a PASS;
   * otherwise the adapter MUST refuse. Real settlement is Phase 2 — adapters
   * may return a simulated result until then.
   */
  submitGatedTransaction(request: GatedTransactionRequest): Promise<GatedTransactionResult>;
}
