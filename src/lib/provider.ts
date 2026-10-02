import { createPublicClient, http, numberToHex, type Hex, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import type { PrivateKeyAccount } from "viem/accounts";

import { CHAIN_ID, RPC_URL } from "./config";

type Req = { method: string; params?: unknown[] };

/**
 * An EIP-1193 provider for the throwaway key: the zkAPI SDK talks to it like it would to MetaMask, except that nothing
 * pops up. Reads go to the configured RPC; `eth_sendTransaction` fills EIP-1559 fees, signs locally and broadcasts.
 * The SDK's documented "manual signing without a wallet extension" path.
 */
export function localProvider(account: PrivateKeyAccount, rpcUrl = RPC_URL) {
  const client: PublicClient = createPublicClient({ chain: { ...mainnet, id: CHAIN_ID }, transport: http(rpcUrl, { timeout: 30_000, retryCount: 2 }) });
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const sent: Hex[] = [];

  async function send(tx: { from?: string; to?: string; data?: Hex; value?: Hex; gas?: Hex; nonce?: Hex }): Promise<Hex> {
    if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) throw Object.assign(new Error("unknown sender"), { code: 4100 });
    const [block, tip, nonce] = await Promise.all([
      client.getBlock(),
      client.estimateMaxPriorityFeePerGas().catch(() => 1_000_000_000n),
      tx.nonce ? Promise.resolve(Number(BigInt(tx.nonce))) : client.getTransactionCount({ address: account.address, blockTag: "pending" }),
    ]);
    const base = block.baseFeePerGas ?? 1_000_000_000n;
    const priority = tip > 100_000_000n ? tip : 100_000_000n;
    const gas = tx.gas ? BigInt(tx.gas) : await client.estimateGas({ account: account.address, to: tx.to as Hex, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
    const raw = await account.signTransaction({
      chainId: CHAIN_ID,
      to: tx.to as Hex,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
      gas,
      nonce,
      maxPriorityFeePerGas: priority,
      maxFeePerGas: base * 2n + priority,
      type: "eip1559",
    });
    const hash = await client.sendRawTransaction({ serializedTransaction: raw });
    sent.push(hash);
    return hash;
  }

  const provider = {
    isZipcoinThrowaway: true,
    address: account.address,
    client,
    async request({ method, params = [] }: Req): Promise<unknown> {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return numberToHex(CHAIN_ID);
        case "net_version":
          return String(CHAIN_ID);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "eth_sendTransaction":
          return send(params[0] as Parameters<typeof send>[0]);
        case "eth_sendRawTransaction":
          throw Object.assign(new Error("not supported"), { code: 4200 });
        default:
          // Everything else is a plain read, forwarded as-is.
          return client.request({ method, params } as never);
      }
    },
    on(event: string, fn: (...a: unknown[]) => void) {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn);
      return provider;
    },
    removeListener(event: string, fn: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return provider;
    },
  };
  return provider;
}

export type LocalProvider = ReturnType<typeof localProvider>;
