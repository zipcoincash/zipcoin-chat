"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseUnits } from "viem";

import { ethFeeBps, fetchQuote, fetchState, isStaleProof, postRelay, quoteZcToEth, zcFee } from "@/lib/api";
import { encodeExchange, encodeRelayData } from "@/lib/codec";
import { ADDR } from "@/lib/config";
import { POOLS, type PoolId } from "@/lib/pools";
import { isApproved, proveSpend, recoverNotes, type Note } from "@/lib/zip";

import { minFunding, useGas } from "./gas";
import { Button, Empty, FeeSummary, Field, fmtEth, inputCls, Notice, TxLink } from "./ui";
import { useWallet } from "./wallet-ctx";
import { useZipKey, ZipKeyPanel } from "./zip-key";

const fmtZc = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const deadlineIn = (sec: number) => BigInt(Math.floor(Date.now() / 1000) + sec);

/**
 * Fund the throwaway address from a zipped note, exactly like /unzip on zipcoin.cash with the recipient fixed to this chat:
 * an ETH note through 0xbow's Entrypoint relay; a ZC note through ZipChanger, sold for ETH on zipcoin's market. The proof
 * is built here; zipcoin's relayer submits it and pays the gas, so the chat's address never touches a wallet of yours.
 */
export function FundFromNote({ mode }: { mode: "wallet" | "phrase" }) {
  const { keys } = useZipKey();
  const { account, client, price, refreshBalance } = useWallet();
  const { data: gas } = useGas();
  const qc = useQueryClient();
  const [pool, setPool] = useState<PoolId>("zc");
  const [label, setLabel] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; eth: bigint } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!step) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [step]);

  const P = POOLS[pool];
  const { data: state } = useQuery({ queryKey: ["state", pool], queryFn: () => fetchState(pool), enabled: !!keys, refetchInterval: pool === "zc" ? 6000 : 12_000 });
  const { data: quote } = useQuery({ queryKey: ["quote"], queryFn: fetchQuote, refetchInterval: 30_000 });
  const notes = useMemo(() => (keys && state ? recoverNotes(keys, P.scope, state).notes : []), [keys, state, P.scope]);
  const note: Note | undefined = notes.find((n) => n.label === label) ?? notes[0];
  const approved = note && state ? isApproved(note, state) : false;

  let value = 0n;
  try {
    value = amount ? parseUnits(amount, 18) : (note?.value ?? 0n);
  } catch {}
  const baseBps = BigInt(quote?.relayFeeBPS ?? "100");
  const zcRate = zcFee(quote, "change", value);
  const bps = pool === "eth" ? ethFeeBps(value, quote?.ethCost?.unzip, baseBps) : zcRate.bps;
  const fee = (value * bps) / 10_000n;
  const { data: ethQuote, isFetching: quoting } = useQuery({
    queryKey: ["zc-to-eth", (value - fee).toString()],
    queryFn: () => quoteZcToEth(value - fee),
    enabled: pool === "zc" && value > fee,
    refetchInterval: 15_000,
  });
  const ethEst = pool === "eth" ? value - fee : ethQuote ? BigInt(ethQuote.eth) : 0n;
  const ethMin = (ethEst * 97n) / 100n;
  const ethUsd = price ? Number(price.answer) / 10 ** price.decimals : (quote?.ethUsd ?? 0);
  const usd = (wei: bigint) => (ethUsd ? `$${(Number(formatEther(wei)) * ethUsd).toFixed(2)}` : "—");
  const minRelay = pool === "eth" ? (quote?.ethCost?.unzip ? (BigInt(quote.ethCost.unzip) * 105n) / 10n : 0n) : zcRate.min;
  // Below this the vault's own gas eats the chat: the deposit and a close must stay a small share of what arrives.
  const minFundWei = gas && ethUsd ? minFunding(gas, ethUsd) : 0n;
  const tooSmall = ethEst > 0n && minFundWei > 0n && ethEst < minFundWei;
  const valid = !!account && !!note && approved && value > 0n && value <= note.value && value >= minRelay && !!quote?.feeRecipient && quote.online && ethEst > 0n && !quoting && !tooSmall;

  const fund = async () => {
    if (!keys || !note || !state || !quote?.feeRecipient || !account) return;
    setError(null);
    setDone(null);
    setElapsed(0);
    try {
      const to = account.address;
      const withdrawal =
        pool === "eth"
          ? { processooor: P.entrypoint, data: encodeRelayData(to, quote.feeRecipient, bps) }
          : { processooor: ADDR.changer, data: encodeExchange(to, ethMin, deadlineIn(30 * 60), quote.feeRecipient, bps) };
      const kind = pool === "eth" ? "unzip-eth" : "change";
      let hash: `0x${string}` | null = null;
      let snapshot = state;
      for (let attempt = 0; attempt < 2 && !hash; attempt++) {
        setStep(attempt ? "the pool moved, rebuilding the proof" : "building the proof in your browser");
        const proof = await proveSpend(keys, note, value, withdrawal, P.scope, snapshot);
        setStep("relaying through zipcoin.cash");
        try {
          hash = await postRelay({ kind, withdrawal, proof });
        } catch (e) {
          if (attempt === 0 && isStaleProof(e)) snapshot = await fetchState(pool);
          else throw e;
        }
      }
      if (!hash) throw new Error("relay failed");
      setStep("waiting for the block");
      await client.waitForTransactionReceipt({ hash, timeout: 15 * 60_000 });
      setDone({ tx: hash, eth: ethEst });
      setAmount("");
      refreshBalance();
      qc.invalidateQueries({ queryKey: ["state", pool] });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "failed");
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="space-y-5">
      <ZipKeyPanel mode={mode} />
      {keys && (
        <>
          <div className="flex gap-1 rounded-md border border-line p-1 text-sm" role="tablist">
            {(["zc", "eth"] as const).map((a) => (
              <button key={a} role="tab" aria-selected={pool === a} onClick={() => { setPool(a); setLabel(null); setAmount(""); setDone(null); setError(null); }} className={`flex-1 rounded px-3 py-1.5 ${pool === a ? "bg-raised text-snow" : "text-muted hover:text-snow"}`}>
                {a === "zc" ? "ZC notes" : "ETH notes (0xbow pool)"}
              </button>
            ))}
          </div>
          {!state ? (
            <p className="caret text-xs text-muted">reading the pool</p>
          ) : !notes.length ? (
            <Empty>{pool === "zc" ? "No zipped ZC for this key. Zip some on zipcoin.cash, or switch to ETH notes." : "No ETH notes for this key in 0xbow's pool."}</Empty>
          ) : (
            <ul className="border border-line">
              {notes.map((n) => {
                const ok = state ? isApproved(n, state) : false;
                const active = note?.label === n.label;
                return (
                  <li key={n.label.toString()}>
                    <button onClick={() => { setLabel(n.label); setAmount(""); }} className={`flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left text-sm last:border-b-0 ${active ? "bg-raised" : "hover:bg-raised/60"}`}>
                      <span>{pool === "zc" ? `${fmtZc(n.value)} ZC` : `${fmtEth(n.value)} ETH`} <span className="text-xs text-faint">note #{n.depositIndex.toString()}</span></span>
                      <span className={`text-xs ${ok ? "text-tap" : "text-burn"}`}>{ok ? "zipped" : "vetting"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {note && !approved && <Notice tone="burn">This note is still being vetted{pool === "eth" ? " by 0xbow's association set provider (usually hours)" : " (minutes)"}. It can fund a chat once approved.</Notice>}
          {note && approved && (
            <>
              <Field label="Amount" hint={<button className="hover:text-snow" onClick={() => setAmount(formatUnits(note.value, 18))}>whole note · max</button>}>
                <input className={`${inputCls} text-lg`} inputMode="decimal" placeholder={formatUnits(note.value, 18)} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
              </Field>
              {value > 0n && (
                <FeeSummary
                  totalLabel="Chat credits you get"
                  total={quoting && !ethQuote ? "quoting…" : gas && ethEst > gas.reserve ? `≈ ${fmtEth(ethEst - gas.reserve)} ETH (${usd(ethEst - gas.reserve)})` : "—"}
                  fees={gas && ethEst ? `≈ ${fmtEth(fee)} ${pool === "zc" ? "ZC" : "ETH"} relay fee + ≈ ${fmtEth(gas.reserve)} ETH kept for the vault's gas` : "—"}
                  rows={[
                    ["Taken from the note", pool === "zc" ? `${fmtZc(value)} ZC` : `${fmtEth(value)} ETH`],
                    [`Relay fee (${Number(bps) / 100}%, zipcoin's only income here)`, pool === "zc" ? `${fmtZc(fee)} ZC` : `${fmtEth(fee)} ETH`],
                    [pool === "zc" ? "Sold for ETH on zipcoin's market (1% sales tax inside)" : "Arrives as ETH", ethEst ? `≈ ${fmtEth(ethEst)} ETH (${usd(ethEst)})` : "—"],
                    ...(gas ? ([["Kept on the key: vault deposit + one close, at today's gas", `≈ ${fmtEth(gas.reserve)} ETH (${usd(gas.reserve)})`]] as [string, string][]) : []),
                  ]}
                  caption={pool === "zc" ? "Plain ETH lands on this chat's address; the price is locked for 30 minutes and the unzip fails rather than deliver less." : "The ETH leaves 0xbow's pool to this chat's address with no on-chain link to your deposit."}
                />
              )}
              {tooSmall && <Notice tone="burn">Too small for a chat right now: gas for the vault deposit and a later close would eat {gas && ethEst ? `${Math.round((Number(gas.reserve) / Number(ethEst)) * 100)}%` : "most"} of it. Fund at least ≈ {fmtEth(minFundWei)} ETH ({usd(minFundWei)}).</Notice>}
              {value > 0n && value < minRelay && <Notice>Minimum {pool === "zc" ? `${fmtZc(minRelay)} ZC` : `${fmtEth(minRelay)} ETH`} so the relay fee covers mainnet gas.</Notice>}
              {quote && !quote.online && <Notice tone="burn">zipcoin&apos;s relayer is refueling. Try again in a few minutes.</Notice>}
              <Button className="w-full" disabled={!valid} busy={!!step} onClick={fund}>
                {pool === "zc" ? "Unzip as ETH into this chat" : "Unzip into this chat"}
              </Button>
              {step && <div className="text-xs text-muted"><span className="caret">{step}</span> <span className="text-faint">{elapsed}s</span></div>}
              {error && <Notice tone="burn">{error}</Notice>}
              {done && (
                <Notice tone="tap">
                  Landed: ≈ {fmtEth(done.eth)} ETH on this chat&apos;s address (<TxLink hash={done.tx} />). Next: deposit it into the vault below.
                </Notice>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
