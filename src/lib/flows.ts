"use client";

import { formatEther, type Address, type PublicClient } from "viem";

import { ethFeeBps, fetchQuote, fetchState, isStaleProof, postRelay, quoteZcToEth, zcFee, type Quote } from "./api";
import { encodeExchange, encodeRelayData } from "./codec";
import { ADDR } from "./config";
import { POOLS, type PoolId } from "./pools";
import type { PoolStateJson } from "./tree";
import { proveSpend, type MasterKeys, type Note } from "./zip";

/** The whole of a note, as ETH, to an address: ZC through ZipChanger (sold on zipcoin's market), ETH through 0xbow's relay. */
export async function unzipNoteTo(opts: {
  keys: MasterKeys;
  note: Note;
  pool: PoolId;
  state: PoolStateJson;
  quote: Quote;
  to: Address;
  client: PublicClient;
  say: (s: string) => void;
}): Promise<{ hash: `0x${string}`; ethEst: bigint }> {
  const { keys, note, pool, quote, to, client, say } = opts;
  if (!quote.feeRecipient || !quote.online) throw new Error("zipcoin's relayer is offline right now; try again in a few minutes");
  const P = POOLS[pool];
  const value = note.value;
  const baseBps = BigInt(quote.relayFeeBPS);
  const bps = pool === "eth" ? ethFeeBps(value, quote.ethCost?.unzip, baseBps) : zcFee(quote, "change", value).bps;
  const fee = (value * bps) / 10_000n;
  let ethEst = value - fee;
  let withdrawal;
  if (pool === "eth") withdrawal = { processooor: P.entrypoint, data: encodeRelayData(to, quote.feeRecipient, bps) };
  else {
    ethEst = BigInt((await quoteZcToEth(value - fee)).eth);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    withdrawal = { processooor: ADDR.changer, data: encodeExchange(to, (ethEst * 97n) / 100n, deadline, quote.feeRecipient, bps) };
  }
  const kind = pool === "eth" ? "unzip-eth" : "change";
  let hash: `0x${string}` | null = null;
  let snapshot = opts.state;
  for (let attempt = 0; attempt < 2 && !hash; attempt++) {
    say(attempt ? "the pool moved, rebuilding the proof" : "building the proof in your browser");
    const proof = await proveSpend(keys, note, value, withdrawal, P.scope, snapshot);
    say("relaying through zipcoin.cash");
    try {
      hash = await postRelay({ kind, withdrawal, proof });
    } catch (e) {
      if (attempt === 0 && isStaleProof(e)) snapshot = await fetchState(pool);
      else throw e;
    }
  }
  if (!hash) throw new Error("relay failed");
  say("waiting for the block");
  await client.waitForTransactionReceipt({ hash, timeout: 15 * 60_000 });
  say(`≈ ${Number(formatEther(ethEst)).toFixed(4)} ETH landed`);
  return { hash, ethEst };
}

export const freshQuote = fetchQuote;
