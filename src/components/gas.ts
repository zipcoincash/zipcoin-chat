"use client";

import { useQuery } from "@tanstack/react-query";

import { MIN_FUND_USD, ZKAPI_CLOSE_GAS, ZKAPI_DEPOSIT_GAS } from "@/lib/config";

import { useWallet } from "./wallet-ctx";

/**
 * What the two zkAPI transactions the throwaway key will sign cost right now. `reserve` is kept on the key and never
 * deposited: the deposit at the expected price with a quarter of headroom, plus one close at twice today's price so the
 * leftovers can come back even if gas doubles.
 */
export function useGas() {
  const { client } = useWallet();
  return useQuery({
    queryKey: ["gas"],
    queryFn: async () => {
      const block = await client.getBlock();
      const base = block.baseFeePerGas ?? 1_000_000_000n;
      const tip = await client.estimateMaxPriorityFeePerGas().catch(() => 1_000_000_000n);
      const price = base + (tip > 100_000_000n ? tip : 100_000_000n);
      const depositCost = (ZKAPI_DEPOSIT_GAS * price * 125n) / 100n;
      const closeCost = ZKAPI_CLOSE_GAS * price * 2n;
      return { price, depositCost, closeCost, reserve: depositCost + closeCost };
    },
    refetchInterval: 15_000,
  });
}

export type Gas = { price: bigint; depositCost: bigint; closeCost: bigint; reserve: bigint };

/** The least worth funding: the deposit's gas stays under a quarter of what arrives and the close reserve is covered; never below MIN_FUND_USD. */
export function minFunding(gas: Gas | undefined, ethUsd: number) {
  if (!gas || !ethUsd) return 0n;
  const byGas = gas.depositCost * 4n + gas.closeCost;
  const byUsd = BigInt(Math.round((MIN_FUND_USD / ethUsd) * 1e18));
  return byGas > byUsd ? byGas : byUsd;
}
