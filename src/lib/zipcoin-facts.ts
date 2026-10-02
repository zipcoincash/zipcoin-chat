"use client";

import { formatEther } from "viem";

import { fetchStats, type Stats } from "./api";
import { ADDR } from "./config";

/**
 * When a message is about zipcoin, the model gets the facts instead of guessing: where the coin comes from, who is behind it
 * (and who is not), what it does, the contract, the official links, and today's numbers from zipcoin.cash/api/stats.
 * Plain statements only; nothing here tells the model what to think of it.
 */
export const mentionsZipcoin = (text: string) => /\bzip ?coins?\b|\bzipcoin\.cash\b|\bsnowmoon\b|\$zc\b/i.test(text) || /\bZC\b/.test(text);

/** The one-line label used wherever ZC shows up in on-chain data (holdings, transfers, the token contract itself). */
export const ZC_LABEL = `ZC (zipcoin, ${ADDR.zc}) is the ERC-20 of zipcoin.cash: the currency from Vitalik Buterin's novel Snowmoon, shipped on Ethereum mainnet by an independent team, not affiliated with the author. It is a real traded token, not a spam airdrop. The team sent vitalik.eth an allocation (the author did not buy it); other wallets hold it because they bought it or received it.`;

export async function zipcoinFacts(): Promise<{ summary: string; context: string }> {
  const s: Stats & { zipped?: string; burned?: string; speeches?: number; deposits?: number; anonSet?: number; salesTaxEth?: string } = await fetchStats().catch(() => ({ ethUsd: 0, ethPerZc: 0, mcapUsd: 0, head: 0 }));
  const usdPerZc = s.ethPerZc * s.ethUsd;
  const num = (v?: string) => (v ? Math.round(Number(formatEther(BigInt(v)))).toLocaleString("en-US") : "n/a");
  const lines = [
    `zipcoin (ZC) — facts as of ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Origin: the currency in Vitalik Buterin's novel "Snowmoon" (vitalik.eth.limo/snowmoon). zipcoin.cash is an independent implementation of it on Ethereum mainnet. It is NOT affiliated with, endorsed by or made by Vitalik Buterin or the Ethereum Foundation.`,
    `Token: ERC-20 "zipcoin" (ZC), contract ${ADDR.zc}, 1,000,000,000 supply, launched on Stockereum; 1% swap fee of which 0.5% ("Veridian sales tax") goes to the project treasury on chain. No owner functions, no mint, no pause, no blacklist; source verified.`,
    `What it does: zip (deposit ZC into a Privacy Pool, 0xbow's privacy-pools-core design) and later unzip to any address with a zero-knowledge proof built in the browser; burn to speak (burn ZC to write a message on Ethereum; the Book at zipcoin.cash/book); knock at a door (burn at someone's ENS name, optionally with a gift); pay zk.money tags; private AI chat at chat.zipcoin.cash paid from zipped notes (works with zkAPI, Open Anonymity + EF dAI; not a partnership). Relayer and contracts cannot alter a message or recipient: they are bound into the proof.`,
    `Allocation note: the team sent vitalik.eth an allocation of ZC; the author did not buy it and has not endorsed the project. A 55,000,000 ZC dev allocation was burned, not sold.`,
    `Official: https://www.zipcoin.cash · X @zipcoincash · the Book bot @zipcoinbook · code https://github.com/zipcoincash (contracts, Privacy Pools fork, agent SDK, chat app) · ENS zipbook.eth`,
    s.ethUsd
      ? `Live numbers (zipcoin.cash/api/stats): price ≈ $${usdPerZc.toFixed(5)} per ZC (${s.ethPerZc.toExponential(3)} ETH), market cap ≈ $${(s.mcapUsd / 1e6).toFixed(2)}M, ETH $${s.ethUsd.toFixed(0)}; zipped ${num(s.zipped)} ZC in ${s.deposits ?? "n/a"} deposits (anonymity set ${s.anonSet ?? "n/a"}); burned ${num(s.burned)} ZC in ${s.speeches ?? "n/a"} speeches; sales tax collected ${s.salesTaxEth ? Number(formatEther(BigInt(s.salesTaxEth))).toFixed(2) : "n/a"} ETH.`
      : "Live numbers: unavailable right now.",
    `Risks, stated plainly: a small, new token with volatile price and thin liquidity; the privacy pool's association set is curated by the project's postman; the private AI chat depends on zkAPI, which is experimental and unaudited.`,
  ];
  return { summary: s.ethUsd ? `zipcoin facts · $${usdPerZc.toFixed(4)}/ZC · mcap $${(s.mcapUsd / 1e6).toFixed(1)}M · ${s.speeches ?? "?"} speeches` : "zipcoin facts", context: lines.join("\n") };
}
