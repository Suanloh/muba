"use client";
/**
 * MOVA wallet context — adapts @mysten/dapp-kit-react (v2) onto the
 * framework-agnostic @mova/wallet abstraction.
 *
 * Exposes:
 * - wallet connection state (WalletConnectionState)
 * - Sui network detection vs the MOVA expected network (MovaNetworkState)
 * - connect / disconnect / switchNetwork
 * - ownership proof (Sign-In-With-Sui personal-message signature)
 * - the MovaWalletProvider used by the gate-enforced execution path
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useCurrentAccount,
  useCurrentNetwork,
  useCurrentWallet,
  useDAppKit,
  useWalletConnection,
  useWallets,
  type UiWallet,
} from "@mysten/dapp-kit-react";
import { MovaError, ErrorCode } from "@mova/logger";
import {
  assertGatePasses,
  buildOwnershipProofRequest,
  chainForNetwork,
  resolveNetworkState,
  verifyOwnershipProofSignature,
  type MovaNetworkState,
  type MovaWalletProvider,
  type OwnershipProof,
  type WalletAccount,
  type WalletConnectionState,
} from "@mova/wallet";
import type { Transaction } from "@mysten/sui/transactions";
import type { UiWalletAccount } from "@wallet-standard/ui";
import {
  dappNetworkToMova,
  EXPECTED_NETWORK,
  type DappNetwork,
} from "./networks.js";
import { switchDemoWalletChain } from "./demo-wallet.js";
import { switchZkLoginWalletChain } from "./zklogin-wallet.js";

export interface MovaWalletContextValue {
  connection: WalletConnectionState;
  network: MovaNetworkState;
  appNetwork: string | null;
  wallets: UiWallet[];
  connect: (uiWallet: UiWallet) => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: (network: DappNetwork) => void;
  requestOwnershipProof: () => Promise<OwnershipProof>;
  verifyOwnershipProof: (proof: OwnershipProof) => Promise<boolean>;
  /**
   * Submit a REAL transaction through the connected wallet. The wallet user
   * must approve the signature. Only called after the deterministic gate
   * passes. Returns a real digest when executed, simulated:false on success.
   */
  executeTransaction: (
    transaction: Transaction,
  ) => Promise<{ ok: boolean; digest: string | null; simulated: boolean; error: string | null }>;
  provider: MovaWalletProvider | null;
  error: string | null;
}

const MovaWalletContext = createContext<MovaWalletContextValue | null>(null);

function toWalletAccount(account: UiWalletAccount): WalletAccount {
  return {
    address: account.address,
    label: account.label ?? null,
    chains: [...account.chains],
    publicKey: Uint8Array.from(account.publicKey),
  };
}

function messageFromError(err: unknown): string {
  if (err instanceof MovaError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Human-readable, actionable network-mismatch message (detected vs expected). */
function networkMismatchMessage(network: MovaNetworkState): string {
  if (network.unknown) {
    return `MOVA could not detect the wallet's network — expected ${network.expected}. Switch the wallet or app to ${network.expected} before approving or executing.`;
  }
  return `Wallet is on ${network.detectedNetwork}, but MOVA expects ${network.expected}. Switch the wallet or app to ${network.expected} before approving or executing.`;
}

export function MovaWalletProvider({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const wallet = useCurrentWallet();
  const conn = useWalletConnection();
  const dAppKit = useDAppKit();
  const wallets = useWallets();
  const appNetwork = useCurrentNetwork();

  const [error, setError] = useState<string | null>(null);
  const connectedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (conn.status === "connected") {
      connectedAtRef.current = connectedAtRef.current ?? Date.now();
    } else {
      connectedAtRef.current = null;
    }
  }, [conn.status]);

  const connection: WalletConnectionState = useMemo(() => {
    if (conn.status === "connected") {
      return {
        status: "connected",
        account: account ? toWalletAccount(account) : null,
        providerName: wallet?.name ?? null,
        error: null,
        connectedAt: connectedAtRef.current,
      };
    }
    if (conn.status === "connecting" || conn.status === "reconnecting") {
      return { status: "connecting", account: null, providerName: null, error: null, connectedAt: null };
    }
    return { status: "disconnected", account: null, providerName: null, error: null, connectedAt: null };
  }, [conn.status, account, wallet]);

  const detectedChain = account?.chains[0] ?? null;
  const network = useMemo(() => resolveNetworkState(EXPECTED_NETWORK, detectedChain), [detectedChain]);

  const connect = useCallback(
    async (uiWallet: UiWallet) => {
      setError(null);
      try {
        const { accounts } = await dAppKit.connectWallet({ wallet: uiWallet });
        if (!accounts || accounts.length === 0) {
          throw new MovaError(ErrorCode.WALLET_CONNECTION_FAILED, "The wallet returned no accounts.");
        }
      } catch (err) {
        setError(messageFromError(err));
        throw err;
      }
    },
    [dAppKit],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await dAppKit.disconnectWallet();
    } catch (err) {
      setError(messageFromError(err));
      throw err;
    }
  }, [dAppKit]);

  const switchNetwork = useCallback(
    (networkName: DappNetwork) => {
      try {
        dAppKit.switchNetwork(networkName);
        const chain = chainForNetwork(dappNetworkToMova(networkName));
        // Best-effort: the in-page demo + zkLogin wallets can switch their own chain.
        switchDemoWalletChain(chain);
        switchZkLoginWalletChain(chain);
      } catch (err) {
        setError(messageFromError(err));
      }
    },
    [dAppKit],
  );

  const executeTransaction = useCallback(
    async (transaction: Transaction) => {
      if (!account) {
        return { ok: false, digest: null, simulated: false, error: "No wallet connected." };
      }
      if (!network.matches) {
        return {
          ok: false,
          digest: null,
          simulated: false,
          error: networkMismatchMessage(network),
        };
      }
      try {
        const res = await dAppKit.signAndExecuteTransaction({ transaction });
        const digest =
          res.$kind === "Transaction" ? res.Transaction.digest : res.FailedTransaction.digest;
        return { ok: true, digest, simulated: false, error: null };
      } catch (err) {
        return { ok: false, digest: null, simulated: false, error: messageFromError(err) };
      }
    },
    [account, network.matches, dAppKit],
  );

  const requestOwnershipProof = useCallback(async (): Promise<OwnershipProof> => {
    if (!account) {
      throw new MovaError(ErrorCode.WALLET_NOT_CONNECTED, "Connect a wallet first.");
    }
    const request = buildOwnershipProofRequest(account.address);
    const { signature } = await dAppKit.signPersonalMessage({
      message: new TextEncoder().encode(request.message),
    });
    return {
      address: request.address,
      message: request.message,
      nonce: request.nonce,
      signature,
      signedAt: Date.now(),
    };
  }, [account, dAppKit]);

  const verifyOwnershipProof = useCallback(async (proof: OwnershipProof): Promise<boolean> => {
    try {
      return await verifyOwnershipProofSignature(proof);
    } catch {
      return false;
    }
  }, []);

  const provider: MovaWalletProvider | null = useMemo(() => {
    if (!account) return null;
    const acc = toWalletAccount(account);
    return {
      name: wallet?.name ?? "Sui Wallet",
      connect: async () => acc,
      disconnect: async () => {
        await dAppKit.disconnectWallet();
      },
      getAccount: () => acc,
      getChainId: () => acc.chains[0] ?? null,
      switchChain: async (chain) => {
        try {
          return switchDemoWalletChain(chain);
        } catch {
          return false;
        }
      },
      signPersonalMessage: async (message) => {
        const { signature } = await dAppKit.signPersonalMessage({
          message: new TextEncoder().encode(message),
        });
        return { address: acc.address, message, signature, signedAt: Date.now() };
      },
      submitGatedTransaction: async (request) => {
        // Safety boundary: refuse anything that did not pass the gate.
        assertGatePasses(request.gateVerdict);
        // Phase 1: no real on-chain submission — honest simulated settlement.
        return { ok: true, digest: null, simulated: true, error: null };
      },
    };
  }, [account, wallet, dAppKit]);

  const value = useMemo<MovaWalletContextValue>(
    () => ({
      connection,
      network,
      appNetwork,
      wallets,
      connect,
      disconnect,
      switchNetwork,
      requestOwnershipProof,
      verifyOwnershipProof,
      executeTransaction,
      provider,
      error,
    }),
    [connection, network, appNetwork, wallets, connect, disconnect, switchNetwork, requestOwnershipProof, verifyOwnershipProof, executeTransaction, provider, error],
  );

  return <MovaWalletContext.Provider value={value}>{children}</MovaWalletContext.Provider>;
}

export function useMovaWallet(): MovaWalletContextValue {
  const ctx = useContext(MovaWalletContext);
  if (!ctx) {
    throw new Error("useMovaWallet must be used within MovaWalletProvider");
  }
  return ctx;
}
