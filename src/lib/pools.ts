import type { Address } from "viem";

import { ADDR, SCOPE_ETH, SCOPE_ZC } from "./config";

/** The two pools a chat can be funded from in v1: zipcoin's ZC pool and 0xbow's canonical ETH pool. Same circuits, same key derivation. */
export type PoolId = "zc" | "eth";

export type PoolInfo = { id: PoolId; asset: string; decimals: number; pool: Address; entrypoint: Address; scope: bigint; asp: "zipcoin" | "0xbow" };

export const POOLS: Record<PoolId, PoolInfo> = {
  zc: { id: "zc", asset: "ZC", decimals: 18, pool: ADDR.pool, entrypoint: ADDR.entrypoint, scope: SCOPE_ZC, asp: "zipcoin" },
  eth: { id: "eth", asset: "ETH", decimals: 18, pool: ADDR.bowEthPool, entrypoint: ADDR.bowEntrypoint, scope: SCOPE_ETH, asp: "0xbow" },
};

export const isPoolId = (s: string | null | undefined): s is PoolId => s === "zc" || s === "eth";
