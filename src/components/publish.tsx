"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createWalletClient, custom, formatEther, parseAbi, parseUnits, type Address } from "viem";
import { mainnet } from "viem/chains";

import { fetchQuote, fetchState, fetchStats, isStaleProof, postRelay, zcFee } from "@/lib/api";
import { encodeSpeech } from "@/lib/codec";
import { ADDR, MAX_MESSAGE_BYTES, MIN_BURN, MIN_BURN_USD, ZIPCOIN_SITE } from "@/lib/config";
import { POOLS } from "@/lib/pools";
import { isApproved, proveSpend, recoverNotes } from "@/lib/zip";

import { Button, inputCls, Notice, TxLink } from "./ui";
import { useWallet } from "./wallet-ctx";
import { useZipKey, ZipKeyPanel } from "./zip-key";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function speak(uint256 _amount, string _message, string _target)",
]);
const bytes = (s: string) => new TextEncoder().encode(s).length;
const trimToBytes = (s: string, max: number) => {
  let t = s.replace(/\s+/g, " ").trim();
  while (bytes(t) > max && t.length) t = t.slice(0, -1);
  return t;
};

/**
 * Put an answer on Ethereum, right here. Burning ZC through ZipBroadcaster writes the words on chain and @zipcoinbook posts them.
 * Anonymous when paid from a zipped note (zipcoin's relayer sends it; the zip key stays in this tab), or plain from a wallet.
 */
export function PublishToBook({ answer, onClose }: { answer: string; onClose: () => void }) {
  const { keys } = useZipKey();
  const { client } = useWallet();
  const [message, setMessage] = useState(() => trimToBytes(answer, MAX_MESSAGE_BYTES - 1));
  const [zc, setZc] = useState("");
  const [mode, setMode] = useState<"anon" | "wallet">("anon");
  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: quote } = useQuery({ queryKey: ["quote"], queryFn: fetchQuote, refetchInterval: 30_000 });
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats, refetchInterval: 60_000 });
  const { data: state } = useQuery({ queryKey: ["state", "zc"], queryFn: () => fetchState("zc"), enabled: !!keys && mode === "anon", refetchInterval: 8000 });

  const usdPerZc = stats ? stats.ethPerZc * stats.ethUsd : 0;
  // The site's floor: $10 of ZC, never below the contract's 1,000 ZC.
  const floorUsd = usdPerZc ? parseUnits(String(Math.ceil(MIN_BURN_USD / usdPerZc)), 18) : MIN_BURN;
  const siteFloor = floorUsd > MIN_BURN ? floorUsd : MIN_BURN;
  // Anonymous burns also have the relayer's own minimum (gas must be covered); whichever is higher is the floor shown.
  const relayMin = mode === "anon" ? zcFee(quote, "speak", 0n).min : 0n;
  const floor = relayMin > siteFloor ? relayMin : siteFloor;
  const floorZc = Math.ceil(Number(formatEther(floor)) / 100) * 100;
  const shownZc = zc || (usdPerZc ? String(floorZc) : "");
  let burn = 0n;
  try {
    burn = shownZc ? parseUnits(shownZc, 18) : 0n;
  } catch {}
  // Anonymous: the relayer's fee comes out of the note on top of the burn; small notes pay a higher rate (contract cap 5%).
  const rate = zcFee(quote, "speak", burn);
  const gross = burn > 0n ? (burn * 10_000n + (10_000n - rate.bps) - 1n) / (10_000n - rate.bps) : 0n;
  const notes = useMemo(() => (keys && state ? recoverNotes(keys, POOLS.zc.scope, state).notes : []), [keys, state]);
  const note = state ? notes.filter((n) => isApproved(n, state) && n.value >= gross).sort((a, b) => Number(a.value - b.value))[0] : undefined;
  const biggest = state ? notes.filter((n) => isApproved(n, state)).sort((a, b) => Number(b.value - a.value))[0] : undefined;
  const msgOk = bytes(message) > 0 && bytes(message) <= MAX_MESSAGE_BYTES;
  const burnOk = burn >= floor;
  const canAnon = !!keys && !!note && gross >= rate.min && !!quote?.feeRecipient && quote.online;
  const injected = () => (typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null : null);

  const publishAnon = async () => {
    if (!keys || !note || !state || !quote?.feeRecipient) return;
    const withdrawal = { processooor: ADDR.broadcaster, data: encodeSpeech(message, "", quote.feeRecipient, rate.bps) };
    let relayed: `0x${string}` | null = null;
    let snapshot = state;
    for (let attempt = 0; attempt < 2 && !relayed; attempt++) {
      setBusy(attempt ? "the pool moved, rebuilding the proof" : "building the proof in your browser");
      const proof = await proveSpend(keys, note, gross, withdrawal, POOLS.zc.scope, snapshot);
      setBusy("relaying through zipcoin.cash");
      try {
        relayed = await postRelay({ kind: "speak", withdrawal, proof });
      } catch (e) {
        if (attempt === 0 && isStaleProof(e)) snapshot = await fetchState("zc");
        else throw e;
      }
    }
    if (!relayed) throw new Error("relay failed");
    setTx(relayed);
    setBusy("waiting for the block");
    await client.waitForTransactionReceipt({ hash: relayed, timeout: 15 * 60_000 });
  };

  const publishWallet = async () => {
    const eth = injected();
    if (!eth) throw new Error("no wallet extension found; pay from a zipped note instead");
    const [from] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
    const wc = createWalletClient({ account: from, chain: mainnet, transport: custom(eth) });
    const bal = await client.readContract({ address: ADDR.zc, abi, functionName: "balanceOf", args: [from] });
    if (bal < burn) throw new Error(`that wallet holds ${Number(formatEther(bal)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC; the burn needs ${shownZc}`);
    const allowance = await client.readContract({ address: ADDR.zc, abi, functionName: "allowance", args: [from, ADDR.broadcaster] });
    if (allowance < burn) {
      setBusy("approve the burn in your wallet");
      const a = await wc.writeContract({ address: ADDR.zc, abi, functionName: "approve", args: [ADDR.broadcaster, burn] });
      await client.waitForTransactionReceipt({ hash: a, timeout: 15 * 60_000 });
    }
    setBusy("confirm the burn in your wallet");
    const h = await wc.writeContract({ address: ADDR.broadcaster, abi, functionName: "speak", args: [burn, message, ""] });
    setTx(h);
    setBusy("waiting for the block");
    await client.waitForTransactionReceipt({ hash: h, timeout: 15 * 60_000 });
  };

  const publish = async () => {
    setError(null);
    setTx(null);
    try {
      if (mode === "anon") await publishAnon();
      else await publishWallet();
      setBusy("published");
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message.split("\n")[0] : "failed");
    }
  };

  if (busy === "published" && tx)
    return (
      <div className="mt-3 space-y-2 border border-tap/50 p-4 text-sm">
        <div className="text-snow">On Ethereum. @zipcoinbook posts it within a minute.</div>
        <div className="flex flex-wrap gap-3 text-xs">
          <a href={`${ZIPCOIN_SITE}/b/${tx}`} target="_blank" rel="noreferrer" className="text-tap underline">read it in the book ↗</a>
          <TxLink hash={tx} />
          <button className="text-muted hover:text-snow" onClick={onClose}>close</button>
        </div>
      </div>
    );

  return (
    <div className="mt-3 space-y-3 border border-line p-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-mono text-xs uppercase tracking-wide text-muted">Publish to the book</div>
        <button className="text-xs text-muted hover:text-snow" onClick={onClose} disabled={!!busy}>cancel</button>
      </div>
      <textarea className={`${inputCls} h-28 resize-none font-serif text-sm`} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!busy} />
      <div className={`text-xs ${msgOk ? "text-faint" : "text-burn"}`}>{bytes(message)} / {MAX_MESSAGE_BYTES} bytes · what gets written on Ethereum, forever</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted">
          <div>Burn (ZC) <span className="text-faint">· min {floorZc.toLocaleString()}{usdPerZc ? ` ≈ $${Math.max(MIN_BURN_USD, Math.round(floorZc * usdPerZc))}` : ""}</span></div>
          <input className={`${inputCls} w-40 text-sm`} inputMode="numeric" value={shownZc} onChange={(e) => setZc(e.target.value.replace(/[^0-9]/g, ""))} disabled={!!busy} />
        </label>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setMode("anon")} className={`press border px-3 py-2 ${mode === "anon" ? "border-tap text-tap" : "border-line text-muted hover:text-snow"}`} disabled={!!busy}>from a zipped note · anonymous</button>
          <button type="button" onClick={() => setMode("wallet")} className={`press border px-3 py-2 ${mode === "wallet" ? "border-tap text-tap" : "border-line text-muted hover:text-snow"}`} disabled={!!busy}>from my wallet · public</button>
        </div>
      </div>
      {mode === "anon" && !keys && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Unlock the zip key that holds your ZC notes. It stays in this tab.</p>
          <ZipKeyPanel mode="phrase" />
        </div>
      )}
      {mode === "anon" && keys && state && !note && burn > 0n && (
        <Notice tone="burn">
          {biggest
            ? `Your biggest zipped ZC note holds ${Number(formatEther(biggest.value)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC; this burn needs ${Number(formatEther(gross)).toLocaleString("en-US", { maximumFractionDigits: 0 })} with the relay fee. Lower the burn or zip more on zipcoin.cash.`
            : "No zipped ZC notes on this key. Zip some ZC on zipcoin.cash first, or pay from your wallet."}
        </Notice>
      )}
      {mode === "anon" && keys && note && (
        <p className="text-xs text-faint">
          {Number(formatEther(burn)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC burned + {Number(formatEther(gross - burn)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC relay fee, from a note of{" "}
          {Number(formatEther(note.value)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC. Nobody can tell who burned; the rest of the note stays zipped.
        </p>
      )}
      {mode === "wallet" && <p className="text-xs text-faint">Your wallet address appears as the speaker in the book. Two confirmations (approve, then burn).</p>}
      {error && <Notice tone="burn">{error}</Notice>}
      <Button className="w-full" busy={!!busy} disabled={!!busy || !msgOk || !burnOk || (mode === "anon" ? !canAnon : false)} onClick={publish}>
        {busy ?? `Burn ${shownZc ? Number(shownZc).toLocaleString() : "…"} ZC and publish`}
      </Button>
      {!burnOk && burn > 0n && <p className="text-xs text-burn">The book&apos;s minimum is {floorZc.toLocaleString()} ZC right now.</p>}
    </div>
  );
}
