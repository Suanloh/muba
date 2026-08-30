/**
 * MOVA chain registry — the single source of truth for the Network/Chain
 * switcher (header), the ecosystem rail (sidebar) and the multi-ecosystem
 * bottom bar. Sui chains are fully usable (MOVA settles on Sui); EVM chains
 * are read/sign-only until EVM settlement ships.
 */
import { DAPP_NETWORKS, type DappNetwork } from "@/lib/wallet/networks";

export interface ChainOption {
  /** Unique key, CAIP-2 flavoured: "sui:testnet" | "eip155:8453". */
  key: string;
  ecosystem: "sui" | "evm";
  label: string;
  /** CSS var, e.g. "var(--chain-sui)" — used for the identity dot. */
  colorVar: string;
  explorerUrl: string;
  /** Sui: the DappNetwork to switch to. */
  dappNetwork?: DappNetwork;
  /** EVM: the 0x-prefixed chain id to switch to. */
  evmChainId?: string;
  /** EVM chains are read/sign only today. */
  readonly?: boolean;
}

export const SUI_CHAINS: ChainOption[] = DAPP_NETWORKS.map((n) => ({
  key: `sui:${n}`,
  ecosystem: "sui",
  label: `Sui ${n.slice(0, 1).toUpperCase()}${n.slice(1)}`,
  colorVar: "var(--chain-sui)",
  explorerUrl: `https://suiscan.xyz/${n}`,
  dappNetwork: n,
}));

/** EVM chains MOVA surfaces. Read/sign only — no EVM settlement yet. */
export const EVM_CHAINS: ChainOption[] = [
  {
    key: "eip155:8453",
    ecosystem: "evm",
    label: "Base",
    colorVar: "var(--chain-base)",
    explorerUrl: "https://basescan.org",
    evmChainId: "0x2105",
    readonly: true,
  },
  {
    key: "eip155:1",
    ecosystem: "evm",
    label: "Ethereum",
    colorVar: "var(--chain-eth)",
    explorerUrl: "https://etherscan.io",
    evmChainId: "0x1",
    readonly: true,
  },
  {
    key: "eip155:42161",
    ecosystem: "evm",
    label: "Arbitrum",
    colorVar: "var(--chain-arb)",
    explorerUrl: "https://arbiscan.io",
    evmChainId: "0xa4b1",
    readonly: true,
  },
  {
    key: "eip155:137",
    ecosystem: "evm",
    label: "Polygon",
    colorVar: "var(--chain-poly)",
    explorerUrl: "https://polygonscan.com",
    evmChainId: "0x89",
    readonly: true,
  },
];

export const ALL_CHAINS: ChainOption[] = [...SUI_CHAINS, ...EVM_CHAINS];

export function chainByKey(key: string): ChainOption | undefined {
  return ALL_CHAINS.find((c) => c.key === key);
}
