"use client";
/**
 * MOVA zkLogin wallet — a wallet-standard Wallet that signs with a Sui
 * zkLogin account derived from an OAuth identity (Google) instead of a
 * private key.
 *
 * - `connect` runs the zkLogin flow (demo by default; real Google OAuth when
 *   NEXT_PUBLIC_ZKLOGIN_GOOGLE_CLIENT_ID + REDIRECT_URI are configured),
 *   derives the zkLogin Sui address and stores the ephemeral keypair in
 *   memory (it never leaves the page).
 * - `sui:signPersonalMessage` / `sui:signTransaction` sign with the ephemeral
 *   key and wrap the signature in a zkLogin signature. Demo sessions use
 *   simulated proof inputs (clearly labelled) — MOVA's default browser
 *   settlement is simulated and never submits on-chain.
 *
 * Gated behind NEXT_PUBLIC_ENABLE_ZKLOGIN_WALLET (default true).
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64, fromBase64 } from "@mysten/sui/utils";
import {
  getWallets,
  ReadonlyWalletAccount,
  SUI_DEVNET_CHAIN,
  SUI_MAINNET_CHAIN,
  SUI_TESTNET_CHAIN,
  type IdentifierArray,
  type SuiSignPersonalMessageFeature,
  type SuiSignTransactionFeature,
  type Wallet,
  type WalletWithFeatures,
} from "@mysten/wallet-standard";
import type {
  StandardConnectFeature,
  StandardEventsFeature,
  StandardEventsListeners,
} from "@wallet-standard/core";
import type { ZkLoginSession } from "@mova/wallet";
import { createZkLoginSignature } from "@mova/wallet";
import {
  loginZkLoginDemo,
  loginZkLoginReal,
  resolveZkLoginMode,
  zkLoginSigningMaterial,
} from "./zklogin";

const ALL_CHAINS: IdentifierArray = [SUI_DEVNET_CHAIN, SUI_TESTNET_CHAIN, SUI_MAINNET_CHAIN];

type ZkLoginWalletFeatures = StandardConnectFeature &
  StandardEventsFeature &
  SuiSignPersonalMessageFeature &
  SuiSignTransactionFeature & {
    "mova:switchChain": { version: "1.0.0"; switchChain: (chain: string) => boolean };
  };

let chainSwitcher: ((chain: string) => boolean) | null = null;

/** Best-effort chain switch for the zkLogin wallet. */
export function switchZkLoginWalletChain(chain: string): boolean {
  return chainSwitcher ? chainSwitcher(chain) : false;
}

function zkLoginIcon(): `data:image/svg+xml;base64,${string}` {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>" +
    "<rect width='40' height='40' rx='8' fill='#7c3aed'/>" +
    "<text x='20' y='27' font-size='20' text-anchor='middle' fill='white' font-family='sans-serif'>Z</text>" +
    "</svg>";
  let b64 = "";
  try {
    b64 = btoa(svg);
  } catch {
    b64 = "";
  }
  return `data:image/svg+xml;base64,${b64}`;
}

// Session + ephemeral key created on connect; kept in memory for signing.
let activeSession: ZkLoginSession | null = null;
let activeKeypair: Ed25519Keypair | null = null;
const sessionListeners = new Set<(session: ZkLoginSession | null) => void>();

/** Current zkLogin session (null when not connected via zkLogin). */
export function getActiveZkLoginSession(): ZkLoginSession | null {
  return activeSession;
}

/** Subscribe to zkLogin session changes; returns an unsubscribe fn. */
export function subscribeZkLoginSession(cb: (session: ZkLoginSession | null) => void): () => void {
  sessionListeners.add(cb);
  return () => sessionListeners.delete(cb);
}

function emitSession(session: ZkLoginSession | null) {
  activeSession = session;
  for (const cb of sessionListeners) cb(session);
}

export function createZkLoginWallet(): Wallet {
  const listeners = new Set<StandardEventsListeners["change"]>();
  let currentChains: IdentifierArray = [SUI_TESTNET_CHAIN];
  let currentAccount: ReadonlyWalletAccount | null = null;

  const emitChange = () => {
    const snapshot: IdentifierArray = [...currentChains];
    for (const listener of listeners) {
      listener({ chains: snapshot, accounts: currentAccount ? [currentAccount] : [] });
    }
  };

  const makeAccount = (session: ZkLoginSession, chains: IdentifierArray) =>
    new ReadonlyWalletAccount({
      address: session.address,
      publicKey: new Uint8Array(0), // zkLogin has no standalone public key
      chains,
      features: ["sui:signPersonalMessage", "mova:switchChain"],
      label: session.providerLabel,
    });

  const features: WalletWithFeatures<ZkLoginWalletFeatures>["features"] = {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => {
        // Real Google OAuth when configured; offline demo otherwise.
        const mode = resolveZkLoginMode();
        const session =
          mode === "real" ? await loginZkLoginReal() : loginZkLoginDemo();
        activeKeypair = Ed25519Keypair.generate();
        currentChains = [SUI_TESTNET_CHAIN];
        currentAccount = makeAccount(session, currentChains);
        emitChange();
        emitSession(session);
        return { accounts: [currentAccount] };
      },
    },
    "standard:events": {
      version: "1.0.0",
      on: (event, listener) => {
        if (event === "change") {
          listeners.add(listener as StandardEventsListeners["change"]);
        }
        return () => {
          if (event === "change") {
            listeners.delete(listener as StandardEventsListeners["change"]);
          }
        };
      },
    },
    "sui:signPersonalMessage": {
      version: "1.1.0",
      signPersonalMessage: async (input) => {
        const session = activeSession;
        const keypair = activeKeypair;
        if (!session || !keypair) {
          throw new Error("zkLogin wallet is not connected.");
        }
        const { signature } = await keypair.signPersonalMessage(input.message);
        const { inputs, maxEpoch } = zkLoginSigningMaterial(session);
        // `signature` is already base64-encoded by the keypair.
        const zkSig = createZkLoginSignature({
          inputs,
          maxEpoch,
          userSignature: signature,
        });
        return { bytes: toBase64(input.message), signature: zkSig };
      },
    },
    "sui:signTransaction": {
      version: "2.0.0",
      signTransaction: async (input) => {
        const session = activeSession;
        const keypair = activeKeypair;
        if (!session || !keypair) {
          throw new Error("zkLogin wallet is not connected.");
        }
        const json = await input.transaction.toJSON();
        const bytes = fromBase64(json);
        const { signature } = await keypair.signTransaction(bytes);
        const { inputs, maxEpoch } = zkLoginSigningMaterial(session);
        // `signature` is already base64-encoded by the keypair.
        const zkSig = createZkLoginSignature({
          inputs,
          maxEpoch,
          userSignature: signature,
        });
        return { bytes: toBase64(bytes), signature: zkSig };
      },
    },
    "mova:switchChain": {
      version: "1.0.0",
      switchChain: (chain) => {
        if (!ALL_CHAINS.includes(chain as IdentifierArray[number])) return false;
        currentChains = [chain as IdentifierArray[number]];
        if (currentAccount) currentAccount = makeAccount(activeSession!, currentChains);
        emitChange();
        return true;
      },
    },
  };

  const wallet: Wallet = {
    version: "1.0.0",
    name: "MOVA zkLogin (Google)",
    icon: zkLoginIcon(),
    get chains() {
      return [...ALL_CHAINS];
    },
    get accounts() {
      return currentAccount ? [currentAccount] : [];
    },
    features,
  };

  chainSwitcher = features["mova:switchChain"].switchChain;

  return wallet;
}

export const zkLoginWalletInitializer = {
  id: "mova-zklogin-wallet",
  initialize() {
    if (typeof window === "undefined") {
      return { unregister: () => undefined };
    }
    const unregister = getWallets().register(createZkLoginWallet());
    return { unregister };
  },
};
