"use client";
/**
 * EVM connection context — a small, dependency-free wrapper around the
 * EIP-1193/6963 adapter, exposing connection state to the UI the same way
 * `useMovaWallet` does for Sui. Connect/Sign only (read surfaces): EVM
 * settlement is out of scope (see docs/ui-ux-redesign.md §4).
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
  connectEvm,
  getEvmBalance,
  listEvmProviders,
  onEvmAccountChanged,
  onEvmChainChanged,
  subscribeEvmProviders,
  switchEvmChain,
} from "./adapter";
import type { EvmConnectionState, EvmProviderInfo } from "./types";

export interface EvmContextValue {
  providers: EvmProviderInfo[];
  connection: EvmConnectionState;
  connect: (info: EvmProviderInfo) => Promise<void>;
  disconnect: () => void;
  switchChain: (chainIdHex: string) => Promise<void>;
  balance: bigint | null;
  refreshBalance: () => Promise<void>;
}

const EvmContext = createContext<EvmContextValue | null>(null);

const INITIAL: EvmConnectionState = {
  status: "disconnected",
  provider: null,
  address: null,
  chainId: null,
  error: null,
};

export function EvmProvider({ children }: { children: React.ReactNode }) {
  const [providers, setProviders] = useState<EvmProviderInfo[]>([]);
  const [connection, setConnection] = useState<EvmConnectionState>(INITIAL);
  const [balance, setBalance] = useState<bigint | null>(null);
  const connectedUuidRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Discover injected providers (EIP-6963 + legacy fallback).
  useEffect(() => {
    const refresh = () => setProviders(listEvmProviders());
    refresh();
    return subscribeEvmProviders(refresh);
  }, []);

  const refreshBalance = useCallback(async () => {
    const address = connection.address;
    const uuid = connectedUuidRef.current;
    if (!address || !uuid) {
      setBalance(null);
      return;
    }
    setBalance(await getEvmBalance(uuid, address));
  }, [connection.address]);

  const connect = useCallback(async (info: EvmProviderInfo) => {
    setConnection((p) => ({ ...p, status: "connecting", error: null }));
    try {
      const { address, chainId } = await connectEvm(info.uuid);
      connectedUuidRef.current = info.uuid;
      cleanupRef.current?.();

      const offAccounts = onEvmAccountChanged(info.uuid, (accounts) => {
        if (accounts.length === 0) {
          cleanupRef.current?.();
          cleanupRef.current = null;
          connectedUuidRef.current = null;
          setConnection(INITIAL);
        } else {
          setConnection((p) => ({ ...p, address: accounts[0] ?? null }));
        }
      });
      const offChain = onEvmChainChanged(info.uuid, (chainIdHex) =>
        setConnection((p) => ({ ...p, chainId: chainIdHex })),
      );
      cleanupRef.current = () => {
        offAccounts();
        offChain();
      };

      setConnection({
        status: "connected",
        provider: info,
        address,
        chainId,
        error: null,
      });
      setBalance(await getEvmBalance(info.uuid, address));
    } catch (err) {
      setConnection((p) => ({
        ...p,
        status: "disconnected",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    connectedUuidRef.current = null;
    setBalance(null);
    setConnection(INITIAL);
  }, []);

  const switchChain = useCallback(
    async (chainIdHex: string) => {
      const uuid = connectedUuidRef.current;
      if (!uuid) throw new Error("No EVM wallet connected.");
      await switchEvmChain(uuid, chainIdHex);
      setConnection((p) => ({ ...p, chainId: chainIdHex }));
    },
    [],
  );

  const value = useMemo<EvmContextValue>(
    () => ({ providers, connection, connect, disconnect, switchChain, balance, refreshBalance }),
    [providers, connection, connect, disconnect, switchChain, balance, refreshBalance],
  );

  return <EvmContext.Provider value={value}>{children}</EvmContext.Provider>;
}

export function useEVM(): EvmContextValue {
  const ctx = useContext(EvmContext);
  if (!ctx) throw new Error("useEVM must be used within EvmProvider");
  return ctx;
}
