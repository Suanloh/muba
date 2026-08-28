"use client";
/**
 * Dev-only Demo Wallet — a wallet-standard Wallet that lets you exercise the
 * full connect → sign → ownership flow without a browser extension.
 *
 * Implements: standard:connect, standard:events, sui:signPersonalMessage, and
 * a custom `mova:switchChain` (used by the app's network switch for this demo
 * wallet). The private key is generated in-memory and never leaves the page.
 *
 * Gated behind NEXT_PUBLIC_ENABLE_DEMO_WALLET (default true in dev).
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
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

const ALL_CHAINS: IdentifierArray = [SUI_DEVNET_CHAIN, SUI_TESTNET_CHAIN, SUI_MAINNET_CHAIN];

type DemoWalletFeatures = StandardConnectFeature &
  StandardEventsFeature &
  SuiSignPersonalMessageFeature &
  SuiSignTransactionFeature & {
    "mova:switchChain": { version: "1.0.0"; switchChain: (chain: string) => boolean };
  };

let chainSwitcher: ((chain: string) => boolean) | null = null;

/** Best-effort chain switch for the in-page demo wallet. */
export function switchDemoWalletChain(chain: string): boolean {
  return chainSwitcher ? chainSwitcher(chain) : false;
}

function demoIcon(): `data:image/svg+xml;base64,${string}` {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>" +
    "<rect width='40' height='40' rx='8' fill='#0ea5e9'/>" +
    "<text x='20' y='27' font-size='22' text-anchor='middle' fill='white' font-family='sans-serif'>M</text>" +
    "</svg>";
  let b64 = "";
  try {
    b64 = btoa(svg);
  } catch {
    b64 = "";
  }
  return `data:image/svg+xml;base64,${b64}`;
}

export function createDemoWallet(): Wallet {
  const keypair = Ed25519Keypair.generate();
  const publicKey = keypair.getPublicKey();
  const address = publicKey.toSuiAddress();
  const listeners = new Set<StandardEventsListeners["change"]>();

  let currentChains: IdentifierArray = [SUI_TESTNET_CHAIN];

  const makeAccount = (chains: IdentifierArray) =>
    new ReadonlyWalletAccount({
      address,
      publicKey: publicKey.toRawBytes(),
      chains,
      features: ["sui:signPersonalMessage", "mova:switchChain"],
      label: "MOVA Demo Account",
    });

  let currentAccount = makeAccount(currentChains);

  const emitChange = () => {
    const snapshot: IdentifierArray = [...currentChains];
    for (const listener of listeners) {
      listener({ chains: snapshot, accounts: [currentAccount] });
    }
  };

  const features: WalletWithFeatures<DemoWalletFeatures>["features"] = {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => ({ accounts: [currentAccount] }),
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
        const { signature } = await keypair.signPersonalMessage(input.message);
        return { bytes: toBase64(input.message), signature };
      },
    },
    "sui:signTransaction": {
      version: "2.0.0",
      signTransaction: async (input) => {
        // v2 input exposes the serialized transaction via toJSON() (base64).
        const json = await input.transaction.toJSON();
        const bytes = fromBase64(json);
        const result = await keypair.signTransaction(bytes);
        return { bytes: toBase64(bytes), signature: result.signature };
      },
    },
    "mova:switchChain": {
      version: "1.0.0",
      switchChain: (chain) => {
        if (!ALL_CHAINS.includes(chain as IdentifierArray[number])) return false;
        currentChains = [chain as IdentifierArray[number]];
        currentAccount = makeAccount(currentChains);
        emitChange();
        return true;
      },
    },
  };

  const wallet: Wallet = {
    version: "1.0.0",
    name: "MOVA Demo Wallet",
    icon: demoIcon(),
    get chains() {
      return [...ALL_CHAINS];
    },
    get accounts() {
      return [currentAccount];
    },
    features,
  };

  chainSwitcher = features["mova:switchChain"].switchChain;

  return wallet;
}

export const demoWalletInitializer = {
  id: "mova-demo-wallet",
  initialize() {
    // Only register in the browser — SSR/static generation has no window.
    if (typeof window === "undefined") {
      return { unregister: () => undefined };
    }
    // Register into the same wallet-standard registry dApp-kit reads.
    const unregister = getWallets().register(createDemoWallet());
    return { unregister };
  },
};
