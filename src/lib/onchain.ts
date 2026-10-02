"use client";

import { createPublicClient, decodeEventLog, formatEther, formatUnits, getAddress, http, isAddress, parseAbi, parseAbiItem, type Address, type Hex, type Log } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

import { RPC_URL } from "./config";

/**
 * Context for the three crypto questions, gathered in the browser from a public RPC and Sourcify. Nothing goes through
 * zipcoin's server: the address or hash you ask about is seen by the RPC you chose and by the model, never by us.
 * Output is compact text the model can read; the UI shows a short summary and sends the text with the question.
 */
const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL, { timeout: 30_000, retryCount: 2 }) });

const erc20 = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const APPROVAL = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const call = async <T,>(fn: () => Promise<T>): Promise<T | null> => fn().catch(() => null);

export type Gathered = { kind: "tx" | "contract" | "wallet"; subject: string; summary: string; context: string };

/** How the subject was named: a forward-resolved name the user typed, or the address's own primary name (reverse, then verified forward). */
type Naming = { name: string; address: Address; via: "forward" | "primary" } | null;
const ensLine = (n: Naming) =>
  n ? (n.via === "forward" ? `ENS: ${n.name} → ${n.address} (forward-resolved)` : `ENS primary name: ${n.name} (reverse record, verified forward)`) : "";

/** Any ENS name incl. subnames (bell.zipbook.eth), normalized the way resolvers expect. */
const looksLikeEns = (s: string) => /^(?:[^\s.]+\.)+eth$/i.test(s.trim());
async function resolveEns(input: string): Promise<{ name: string; address: Address }> {
  let name: string;
  try {
    name = normalize(input.trim());
  } catch {
    throw new Error("that ENS name is not valid");
  }
  const address = await client.getEnsAddress({ name });
  if (!address) throw new Error("that name does not resolve to an address");
  return { name, address };
}
/** Reverse lookup that only trusts a name whose forward record points back at the address. */
async function primaryName(address: Address): Promise<Naming> {
  const name = await call(() => client.getEnsName({ address }));
  if (!name) return null;
  const forward = await call(() => client.getEnsAddress({ name: normalize(name) }));
  return forward && getAddress(forward) === getAddress(address) ? { name, address, via: "primary" } : null;
}

/** Verified source and metadata from Sourcify (public, CORS-enabled). Returns null when unverified. */
async function sourcify(address: Address) {
  const r = await fetch(`https://sourcify.dev/server/v2/contract/1/${address}?fields=all`, { cache: "no-store" }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = (await r.json()) as { match?: string; compilation?: { name?: string; compilerVersion?: string; fullyQualifiedName?: string }; sources?: Record<string, { content: string }>; abi?: unknown[]; metadata?: { output?: { devdoc?: unknown } } };
  const files = Object.entries(j.sources ?? {});
  const main = files.find(([k]) => j.compilation?.fullyQualifiedName?.startsWith(k)) ?? files.sort((a, b) => b[1].content.length - a[1].content.length)[0];
  return { match: j.match ?? null, name: j.compilation?.name ?? null, compiler: j.compilation?.compilerVersion ?? null, files: files.length, abi: j.abi ?? null, mainSource: main ? { path: main[0], content: main[1].content } : null };
}

function tokenTransfers(logs: Log[]) {
  const out: string[] = [];
  for (const l of logs) {
    try {
      const ev = decodeEventLog({ abi: [TRANSFER, APPROVAL], data: l.data, topics: l.topics });
      if (ev.eventName === "Transfer") out.push(`Transfer ${short(ev.args.from)} -> ${short(ev.args.to)} value ${ev.args.value} (token ${short(l.address)})`);
      else out.push(`Approval owner ${short(ev.args.owner)} spender ${short(ev.args.spender)} value ${ev.args.value} (token ${short(l.address)})`);
    } catch {
      out.push(`log from ${short(l.address)} topic0 ${l.topics[0]?.slice(0, 10)}`);
    }
  }
  return out;
}

export async function gatherTx(hash: Hex): Promise<Gathered> {
  const [tx, rc] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  const block = await call(() => client.getBlock({ blockNumber: rc.blockNumber }));
  const toCode = tx.to ? await call(() => client.getCode({ address: tx.to! })) : null;
  const toName = tx.to && toCode && toCode !== "0x" ? await call(() => client.readContract({ address: tx.to!, abi: erc20, functionName: "name" })) : null;
  const sel = tx.input.slice(0, 10);
  let sig: string | null = null;
  if (sel.length === 10 && sel !== "0x") {
    const r = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${sel}&filter=true`).catch(() => null);
    const j = r && r.ok ? ((await r.json()) as { result?: { function?: Record<string, { name: string }[]> } }) : null;
    sig = j?.result?.function?.[sel]?.[0]?.name ?? null;
  }
  const lines = [
    `Transaction ${hash}`,
    `status: ${rc.status === "success" ? "success" : "REVERTED"}; block ${rc.blockNumber}${block ? ` (${new Date(Number(block.timestamp) * 1000).toISOString()})` : ""}`,
    `from: ${tx.from}`,
    `to: ${tx.to ?? "(contract creation)"}${toName ? ` (contract: ${toName})` : toCode && toCode !== "0x" ? " (contract)" : tx.to ? " (externally owned account)" : ""}`,
    `value: ${formatEther(tx.value)} ETH`,
    `gas used: ${rc.gasUsed} of ${tx.gas}; effective gas price ${formatUnits(rc.effectiveGasPrice, 9)} gwei; fee ${formatEther(rc.gasUsed * rc.effectiveGasPrice)} ETH`,
    `function selector: ${sel}${sig ? ` = ${sig}` : ""}; calldata length ${(tx.input.length - 2) / 2} bytes`,
    `logs (${rc.logs.length}):`,
    ...tokenTransfers(rc.logs.slice(0, 30)).map((s) => `  ${s}`),
    rc.logs.length > 30 ? `  … ${rc.logs.length - 30} more` : "",
  ];
  return { kind: "tx", subject: hash, summary: `${rc.status === "success" ? "success" : "reverted"} · ${sig ?? sel} · ${rc.logs.length} logs`, context: lines.filter(Boolean).join("\n") };
}

export async function gatherContract(address: Address, naming: Naming = null): Promise<Gathered> {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error("no contract code at that address (it is a plain wallet)");
  const [name, symbol, decimals, supply, owner, src, ens] = await Promise.all([
    call(() => client.readContract({ address, abi: erc20, functionName: "name" })),
    call(() => client.readContract({ address, abi: erc20, functionName: "symbol" })),
    call(() => client.readContract({ address, abi: erc20, functionName: "decimals" })),
    call(() => client.readContract({ address, abi: erc20, functionName: "totalSupply" })),
    call(() => client.readContract({ address, abi: erc20, functionName: "owner" })),
    sourcify(address),
    naming ? Promise.resolve(naming) : primaryName(address),
  ]);
  const isToken = name !== null && symbol !== null && decimals !== null;
  const eip1967 = await call(() => client.getStorageAt({ address, slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" }));
  const impl = eip1967 && BigInt(eip1967) !== 0n ? (`0x${eip1967.slice(-40)}` as Address) : null;
  const source = src?.mainSource ? src.mainSource.content.slice(0, 12_000) : null;
  const lines = [
    `Contract ${address}`,
    ensLine(ens),
    `bytecode: ${(code.length - 2) / 2} bytes${impl ? `; EIP-1967 proxy, implementation ${impl} (UPGRADEABLE)` : ""}`,
    isToken ? `ERC-20: ${name} (${symbol}), ${decimals} decimals, total supply ${formatUnits(supply ?? 0n, decimals)}` : "not a standard ERC-20 (name/symbol/decimals missing)",
    owner ? `owner(): ${owner}${owner === "0x0000000000000000000000000000000000000000" ? " (renounced)" : ""}` : "owner(): none exposed",
    src ? `verified source on Sourcify: ${src.match} match, ${src.name ?? "?"}, ${src.compiler ?? "?"}, ${src.files} files` : "NOT verified on Sourcify (source unavailable; Etherscan may still have it)",
    source ? `main source (${src!.mainSource!.path}, first 12k chars):\n${source}` : "",
  ];
  return { kind: "contract", subject: ens ? `${ens.name} (${address})` : address, summary: `${isToken ? `${symbol} token` : "contract"} · ${src ? "verified" : "unverified"}${impl ? " · proxy" : ""}${owner && owner !== "0x0000000000000000000000000000000000000000" ? " · has owner" : ""}`, context: lines.filter(Boolean).join("\n") };
}

type BsTransfer = { timestamp: string; from: { hash: string }; to: { hash: string }; total?: { value?: string; decimals?: string }; token: { symbol?: string; decimals?: string; name?: string } };
type BsTx = { timestamp: string; hash: string; method?: string | null; from: { hash: string }; to?: { hash: string; name?: string | null } | null; value: string; status?: string; fee?: { value?: string } };
type BsToken = { token: { symbol?: string; decimals?: string; name?: string; address?: string }; value: string };
const bs = async <T,>(path: string): Promise<T | null> => {
  const r = await fetch(`https://eth.blockscout.com/api/v2${path}`, { cache: "no-store" }).catch(() => null);
  return r && r.ok ? ((await r.json()) as T) : null;
};
const units = (v: string | undefined, d: string | undefined) => (v ? formatUnits(BigInt(v), Number(d ?? 18)) : "?");
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

export async function gatherWallet(address: Address, naming: Naming = null): Promise<Gathered> {
  const [balance, nonce, code, ens] = await Promise.all([client.getBalance({ address }), client.getTransactionCount({ address }), client.getCode({ address }), naming ? Promise.resolve(naming) : primaryName(address)]);
  // History and holdings from Blockscout's public explorer API (no key, read straight from the browser); balances from the RPC.
  const [held, transfers, txs] = await Promise.all([
    bs<{ items: BsToken[] }>(`/addresses/${address}/tokens?type=ERC-20`),
    bs<{ items: BsTransfer[] }>(`/addresses/${address}/token-transfers?type=ERC-20`),
    bs<{ items: BsTx[] }>(`/addresses/${address}/transactions`),
  ]);
  const me = address.toLowerCase();
  const tokens = (held?.items ?? []).slice(0, 25).map((t) => `${units(t.value, t.token.decimals)} ${t.token.symbol ?? "?"}${t.token.name ? ` (${t.token.name})` : ""}`);
  const moves = (transfers?.items ?? []).slice(0, 25).map((t) => `${ago(t.timestamp)}: ${t.from.hash.toLowerCase() === me ? "sent" : "received"} ${units(t.total?.value, t.total?.decimals ?? t.token.decimals)} ${t.token.symbol ?? "?"} ${t.from.hash.toLowerCase() === me ? "to" : "from"} ${short(t.from.hash.toLowerCase() === me ? t.to.hash : t.from.hash)}`);
  const calls = (txs?.items ?? []).slice(0, 25).map((t) => `${ago(t.timestamp)}: ${t.from.hash.toLowerCase() === me ? "sent" : "received"} ${t.method ?? (BigInt(t.value) > 0n ? "ETH transfer" : "call")} ${t.from.hash.toLowerCase() === me ? "to" : "from"} ${short((t.from.hash.toLowerCase() === me ? t.to?.hash : t.from.hash) ?? "?")}${t.to?.name ? ` (${t.to.name})` : ""}${BigInt(t.value) > 0n ? `, ${formatEther(BigInt(t.value))} ETH` : ""}${t.status && t.status !== "ok" ? ` [${t.status}]` : ""}`);
  const lines = [
    `Wallet ${address}${code && code.startsWith("0xef0100") ? ` (an ordinary account with an EIP-7702 delegation to ${"0x" + code.slice(8, 48)}: it runs that contract's code when called)` : code && code !== "0x" ? " (this is a CONTRACT account, e.g. a smart wallet)" : ""}`,
    ensLine(ens),
    `ETH balance: ${formatEther(balance)} ETH; transactions sent (nonce): ${nonce}`,
    `ERC-20 holdings (${held?.items.length ?? "unknown"}): ${tokens.join("; ") || "none"}`,
    `recent ERC-20 transfers (newest first, up to 25): ${moves.length ? "" : held ? "none" : "unavailable"}`,
    ...moves.map((m) => `  ${m}`),
    `recent transactions (newest first, up to 25): ${calls.length ? "" : txs ? "none" : "unavailable"}`,
    ...calls.map((m) => `  ${m}`),
    `note: airdropped or spam tokens appear in holdings like any other; the owner did not necessarily acquire them.`,
  ];
  const last = txs?.items?.[0]?.timestamp;
  return { kind: "wallet", subject: ens ? `${ens.name} (${address})` : address, summary: `${Number(formatEther(balance)).toFixed(4)} ETH · ${held?.items.length ?? "?"} tokens · ${nonce} txs${last ? ` · last ${ago(last)}` : ""}`, context: lines.filter(Boolean).join("\n") };
}

export const looksLikeTx = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s.trim());
export const looksLikeAddress = (s: string) => isAddress(s.trim());

export const QUESTIONS = {
  tx: { label: "Explain a tx", placeholder: "transaction hash (0x…64 hex)", prompt: "Explain this Ethereum transaction to me in plain words: what it did, who paid whom what, whether it succeeded, anything unusual or risky. Be concrete and short." },
  contract: { label: "Check a contract", placeholder: "contract address or ENS name", prompt: "Review this Ethereum contract for a non-expert who is about to interact with it or buy its token: what it is, who controls it (owner, upgradeability, mint/pause/blacklist/fee powers if visible in the source), whether the source is verified, and the main risks. Say clearly what you could not verify. Short, concrete, no hype." },
  wallet: { label: "Analyse a wallet", placeholder: "wallet address or ENS name (0x… or name.eth)", prompt: "Analyse this Ethereum wallet from the data below: what it holds, how active it is, what it has been doing recently, and anything notable. Keep it short and factual; say what the data cannot tell you." },
} as const;
export type QuestionKind = keyof typeof QUESTIONS;

export async function gather(kind: QuestionKind, input: string): Promise<Gathered> {
  const s = input.trim();
  if (kind === "tx") {
    if (!looksLikeTx(s)) throw new Error("that is not a transaction hash");
    return gatherTx(s as Hex);
  }
  let address: Address;
  let naming: Naming = null;
  if (looksLikeAddress(s)) address = getAddress(s);
  else if (looksLikeEns(s)) {
    const r = await resolveEns(s);
    address = r.address;
    naming = { ...r, via: "forward" };
  } else throw new Error("that is not an address or an ENS name");
  return kind === "contract" ? gatherContract(address, naming) : gatherWallet(address, naming);
}
