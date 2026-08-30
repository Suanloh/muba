/** EVM wallet info surfaced to the UI (EIP-6963 discovery). */
export interface EvmProviderInfo {
  uuid: string;
  name: string;
  icon?: string;
  rdns: string;
}

/** Normalized EVM connection state (mirrors MOVA's Sui WalletConnectionState). */
export interface EvmConnectionState {
  status: "disconnected" | "connecting" | "connected";
  provider: EvmProviderInfo | null;
  address: string | null;
  /** 0x-prefixed hex chain id, e.g. "0x1". */
  chainId: string | null;
  error: string | null;
}
