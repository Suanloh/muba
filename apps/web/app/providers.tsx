"use client";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKit } from "@/lib/wallet/dapp-kit";
import { MovaWalletProvider } from "@/lib/wallet/mova-wallet-context";
import { EvmProvider } from "@/lib/wallet/evm/hook";
import { AppStoreProvider } from "@/lib/store/app-store";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <MovaWalletProvider>
        <EvmProvider>
          <AppStoreProvider>{children}</AppStoreProvider>
        </EvmProvider>
      </MovaWalletProvider>
    </DAppKitProvider>
  );
}
