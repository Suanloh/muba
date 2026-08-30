"use client";
/**
 * User-added custom tokens (Portfolio). Persisted in localStorage. Unknown
 * symbols are allowed but rendered "unverified" so the user is never misled.
 */
import { useCallback, useEffect, useState } from "react";
import type { BalanceAsset } from "./balances";

export interface CustomTokenInput {
  symbol: string;
  name?: string;
  decimals?: number;
  chain: "sui" | "evm";
}

const STORAGE_KEY = "mova-custom-tokens";

function load(): BalanceAsset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BalanceAsset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useCustomTokens(): {
  customTokens: BalanceAsset[];
  addCustomToken: (input: CustomTokenInput) => { ok: boolean; error?: string; token?: BalanceAsset };
  removeCustomToken: (id: string) => void;
} {
  const [customTokens, setCustomTokens] = useState<BalanceAsset[]>([]);

  useEffect(() => {
    setCustomTokens(load());
  }, []);

  const persist = useCallback((next: BalanceAsset[]) => {
    setCustomTokens(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode — session only */
    }
  }, []);

  const addCustomToken = useCallback(
    (input: CustomTokenInput): { ok: boolean; error?: string; token?: BalanceAsset } => {
      const symbol = input.symbol.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
        return { ok: false, error: "Symbol must be 2–12 letters/digits, e.g. WBTC." };
      }
      const id = `${input.chain}:custom:${symbol.toLowerCase()}`;
      if (customTokens.some((t) => t.id === id)) {
        return { ok: false, error: `${symbol} is already in your list.` };
      }
      const token: BalanceAsset = {
        id,
        symbol,
        name: input.name?.trim() || symbol,
        decimals: input.decimals ?? 8,
        chain: input.chain,
        isNative: false,
        verified: false, // user-added — not from the MOVA registry
        amount: null,
        priceUsd: null,
        usdValue: null,
        change24h: null,
        priceSource: "none",
      };
      persist([...customTokens, token]);
      return { ok: true, token };
    },
    [customTokens, persist],
  );

  const removeCustomToken = useCallback(
    (id: string) => {
      persist(customTokens.filter((t) => t.id !== id));
    },
    [customTokens, persist],
  );

  return { customTokens, addCustomToken, removeCustomToken };
}
