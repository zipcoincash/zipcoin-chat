"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import { CHAIN_ID, RPC_URL } from "@/lib/config";
import { ensureAccount } from "@/lib/throwaway";
import { zkapi, type PriceQuote, type Snapshot } from "@/lib/zkapi";

type Ctx = {
  /** The throwaway funding key's account; null until IndexedDB answered. */
  account: PrivateKeyAccount | null;
  client: PublicClient;
  /** ETH on the throwaway address, refreshed every few seconds. */
  balance: bigint | null;
  refreshBalance: () => void;
  /** zkAPI SDK snapshot; null until the SDK finished init (worker, config, manifest checks). */
  snapshot: Snapshot | null;
  sdkError: string | null;
  price: PriceQuote | null;
  /** Reload the throwaway key after a backup import. */
  reloadKey: () => Promise<void>;
};

const C = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createPublicClient({ chain: { ...mainnet, id: CHAIN_ID }, transport: http(RPC_URL, { timeout: 20_000 }) }), []);
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [price, setPrice] = useState<PriceQuote | null>(null);
  const unsub = useRef<(() => void) | null>(null);

  const loadKey = () => ensureAccount().then(setAccount);
  useEffect(() => {
    let alive = true;
    ensureAccount()
      .then((a) => alive && setAccount(a))
      .catch((e) => alive && setSdkError(e instanceof Error ? e.message : "no storage"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    zkapi(account)
      .then(({ client: c }) => {
        if (!alive) return;
        setSnapshot(c.snapshot());
        unsub.current?.();
        unsub.current = c.subscribe((s) => setSnapshot({ ...s }));
        const tick = () => c.refreshEthUsdPrice().then((p) => alive && setPrice(p)).catch((e) => console.warn("[price]", e instanceof Error ? e.message : e));
        tick();
        timer = setInterval(tick, 60_000);
      })
      .catch((e) => alive && setSdkError(e instanceof Error ? e.message.split("\n")[0] : "zkAPI SDK failed to start"));
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [account]);

  const { data: balance, refetch } = useQuery({
    queryKey: ["bal", account?.address],
    queryFn: () => client.getBalance({ address: account!.address }),
    enabled: !!account,
    refetchInterval: 6000,
  });

  const value: Ctx = {
    account,
    client,
    balance: balance ?? null,
    refreshBalance: () => void refetch(),
    snapshot,
    sdkError,
    price,
    reloadKey: loadKey,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useWallet() {
  const v = useContext(C);
  if (!v) throw new Error("WalletProvider missing");
  return v;
}

/** The SDK client itself, for pages that act (deposit, chat, withdraw). */
export function useZkapiClient() {
  const { account } = useWallet();
  const [c, setC] = useState<Awaited<ReturnType<typeof zkapi>>["client"] | null>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    zkapi(account).then((r) => alive && setC(r.client)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [account]);
  return c;
}
