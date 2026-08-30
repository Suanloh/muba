/**
 * Dependency-free EVM adapter — EIP-1193 injected provider + EIP-6963
 * discovery, zero runtime deps (no wagmi/viem needed for connect/read).
 *
 * WalletConnect v2 is the pluggable *mobile* transport for EVM (see
 * docs/ui-ux-redesign.md §4): this adapter covers the desktop injected path;
 * a WalletConnect transport would implement the same surface behind the
 * `MovaWalletProvider` seam.
 */

export interface Eip1193Request {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

export interface Eip1193Provider {
  request: (args: Eip1193Request) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon?: string; rdns: string };
  provider: Eip1193Provider;
}

const providers = new Map<string, Eip6963Detail>();
const subscribers = new Set<() => void>();
let listening = false;

function emit(): void {
  subscribers.forEach((cb) => cb());
}

function injectedFallback(): Eip6963Detail | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!eth) return null;
  const meta = eth as unknown as Record<string, unknown>;
  const name = meta.isMetaMask ? "MetaMask" : meta.isRabby ? "Rabby" : "Browser wallet";
  return { info: { uuid: "injected", name, rdns: "injected" }, provider: eth };
}

/** Attach the EIP-6963 discovery listener and request providers (idempotent). */
function ensureDiscovery(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  window.addEventListener(
    "eip6963:announceProvider",
    ((event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.uuid && detail.provider) {
        providers.set(detail.info.uuid, detail);
        emit();
      }
    }) as EventListener,
  );
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** Snapshot of discovered EVM wallets (with a legacy injected fallback). */
export function listEvmProviders(): { uuid: string; name: string; icon?: string; rdns: string }[] {
  ensureDiscovery();
  const items = [...providers.values()];
  if (items.length === 0) {
    const fb = injectedFallback();
    if (fb) items.push(fb);
  }
  return items.map((d) => d.info);
}

export function subscribeEvmProviders(cb: () => void): () => void {
  ensureDiscovery();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function findEvmProvider(uuid: string): Eip6963Detail | null {
  const found = providers.get(uuid);
  if (found) return found;
  const fb = injectedFallback();
  return fb && fb.info.uuid === uuid ? fb : null;
}

/** Request accounts + chain from a specific provider (EIP-1193). */
export async function connectEvm(uuid: string): Promise<{ address: string; chainId: string }> {
  const detail = findEvmProvider(uuid);
  if (!detail) throw new Error("EVM wallet not found. Is the extension installed?");
  const accounts = await detail.provider.request({ method: "eth_requestAccounts", params: [] });
  const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
  if (!address) throw new Error("The EVM wallet returned no account.");
  const chainRaw = await detail.provider.request({ method: "eth_chainId", params: [] });
  return { address, chainId: typeof chainRaw === "string" ? chainRaw : "0x1" };
}

/** Switch the EVM provider's active chain (adds the chain if missing). */
export async function switchEvmChain(uuid: string, chainIdHex: string): Promise<void> {
  const detail = findEvmProvider(uuid);
  if (!detail) throw new Error("EVM wallet not found.");
  try {
    await detail.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      // Chain not added to the wallet yet — request it.
      await detail.provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } else {
      throw err;
    }
  }
}

/** Read the native token balance (wei, "latest" block). Best-effort. */
export async function getEvmBalance(uuid: string, address: string): Promise<bigint | null> {
  const detail = findEvmProvider(uuid);
  if (!detail) return null;
  try {
    const hex = await detail.provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    return typeof hex === "string" ? BigInt(hex) : null;
  } catch {
    return null;
  }
}

/** Subscribe to account changes. Returns an unsubscribe fn (no-op if unsupported). */
export function onEvmAccountChanged(uuid: string, cb: (accounts: string[]) => void): () => void {
  const provider = findEvmProvider(uuid)?.provider;
  if (!provider?.on) return () => {};
  const listener = (...args: unknown[]) => {
    const accounts = args[0];
    if (Array.isArray(accounts)) cb(accounts.map(String));
  };
  provider.on("accountsChanged", listener);
  return () => provider.removeListener?.("accountsChanged", listener);
}

/** Subscribe to chain changes. Returns an unsubscribe fn (no-op if unsupported). */
export function onEvmChainChanged(uuid: string, cb: (chainIdHex: string) => void): () => void {
  const provider = findEvmProvider(uuid)?.provider;
  if (!provider?.on) return () => {};
  const listener = (...args: unknown[]) => {
    const chain = args[0];
    if (typeof chain === "string") cb(chain);
  };
  provider.on("chainChanged", listener);
  return () => provider.removeListener?.("chainChanged", listener);
}
