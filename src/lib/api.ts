import { ZIPCOIN_API } from "./config";
import type { PoolId } from "./pools";
import type { PoolStateJson } from "./tree";

/** Reads from zipcoin.cash: pool state (public events), relayer quote, price. The relayer sees proofs, never keys or notes. */
const get = async <T,>(path: string): Promise<T> => {
  const r = await fetch(`${ZIPCOIN_API}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
};

export type Quote = {
  feeRecipient: `0x${string}` | null;
  online: boolean;
  relayFeeBPS: string;
  minWithdraw: string;
  minSpeak?: string;
  ethCost: { unzip: string; tag: string; speak: string };
  zcCost?: { unzip: string; speak: string; door: string; tag: string; change: string };
  ethUsd: number;
  subsidyLeftWei: string;
};
export type Stats = { ethUsd: number; ethPerZc: number; mcapUsd: number; head: number };

export const fetchState = (pool: PoolId) => get<PoolStateJson>(`/api/state?pool=${pool}`);
export const fetchQuote = () => get<Quote>("/api/relay");
export const fetchStats = () => get<Stats>("/api/stats");
export const quoteZcToEth = (zc: bigint) => get<{ eth: string }>(`/api/pay-quote?zcToEth=${zc}`);

export async function postRelay(body: unknown): Promise<`0x${string}`> {
  const r = await fetch(`${ZIPCOIN_API}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "relay failed");
  return j.hash;
}

/** Errors caused by the pool moving while the proof was being built; a fresh proof fixes them. */
export const isStaleProof = (e: unknown) => /association set|moved on|UnknownStateRoot|IncorrectASPRoot/i.test(e instanceof Error ? e.message : String(e));

/** The contracts' relay fee caps for ZC notes: Entrypoint config 3% for unzip; ZipChanger 5%. */
export const ZC_FEE_CAP = { unzip: 300n, change: 500n, speak: 500n } as const;

/** Relay fee rate for a ZC note: the base rate, or more when the note is small so the fee still covers gas, never above the cap. */
export function zcFee(q: Quote | undefined, kind: keyof typeof ZC_FEE_CAP, value: bigint) {
  const base = BigInt(q?.relayFeeBPS ?? "100");
  const cost = BigInt(q?.zcCost?.[kind] ?? "0");
  if (cost === 0n) {
    // Gas covered by the relayer's subsidy today: only the legacy per-kind minimum applies.
    const min = BigInt((kind === "speak" ? q?.minSpeak : q?.minWithdraw) ?? "0");
    return { bps: base, min, ok: value >= min };
  }
  const need = (cost * 110n) / 100n;
  const cap = ZC_FEE_CAP[kind];
  const min = (need * 10_000n * 102n) / (cap * 100n);
  const bps = value > 0n ? (need * 10_000n + value - 1n) / value + 1n : base;
  const rate = bps > base ? bps : base;
  return { bps: rate > cap ? cap : rate, min, ok: value >= min && rate <= cap };
}

/** Relay fee rate for an ETH note in 0xbow's pool: at least the base rate, enough to cover gas (+5%), capped at the pool's 10%. */
export function ethFeeBps(value: bigint, costWei: string | undefined, base: bigint) {
  if (value <= 0n || !costWei) return base;
  const need = (BigInt(costWei) * 105n) / 100n;
  const bps = (need * 10_000n + value - 1n) / value + 1n;
  const out = bps > base ? bps : base;
  return out > 1000n ? 1000n : out;
}
