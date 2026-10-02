"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatEther } from "viem";

import { fetchQuote, fetchState } from "@/lib/api";
import { unzipNoteTo } from "@/lib/flows";
import { POOLS } from "@/lib/pools";
import { isApproved, recoverNotes } from "@/lib/zip";
import { humanize } from "@/lib/zkapi";

import { useGas } from "./gas";
import { Button, Notice } from "./ui";
import { useWallet, useZkapiClient } from "./wallet-ctx";
import { useZipKey } from "./zip-key";

/**
 * A gift link opened the page: the phrase is unlocked, the note is in zipcoin's pool. One button runs the whole thing —
 * unzip the note as ETH to this browser's funding key, deposit it into zkAPI's vault, open the chat — and narrates each step.
 */
export function ClaimFlow() {
  const { keys } = useZipKey();
  const { account, client, snapshot, refreshBalance } = useWallet();
  const zk = useZkapiClient();
  const { data: gas } = useGas();
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: state } = useQuery({ queryKey: ["state", "zc"], queryFn: () => fetchState("zc"), enabled: !!keys, refetchInterval: 6000 });
  const { data: quote } = useQuery({ queryKey: ["quote"], queryFn: fetchQuote, refetchInterval: 30_000 });
  const notes = useMemo(() => (keys && state ? recoverNotes(keys, POOLS.zc.scope, state).notes : []), [keys, state]);
  const note = notes.find((n) => state && isApproved(n, state)) ?? notes[0];
  const approved = !!note && !!state && isApproved(note, state);
  const hasNote = !!snapshot?.wallet?.note;
  const say = (raw: string) => {
    const s = humanize(raw);
    setLog((l) => (l[l.length - 1] === s ? l : [...l, s]));
  };

  const claim = async () => {
    if (!keys || !note || !state || !quote || !account || !zk || !gas) return;
    setBusy(true);
    setError(null);
    setLog([]);
    try {
      say("1/3 moving the gift to this browser's key");
      await unzipNoteTo({ keys, note, pool: "zc", state, quote, to: account.address, client, say });
      refreshBalance();
      // Fresh balance, minus the gas reserve, whole gwei.
      let balance = 0n;
      for (let i = 0; i < 20 && balance === 0n; i++) {
        balance = await client.getBalance({ address: account.address });
        if (balance === 0n) await new Promise((r) => setTimeout(r, 3000));
      }
      const principal = balance > gas.reserve ? ((balance - gas.reserve) / 10n ** 9n) * 10n ** 9n : 0n;
      if (principal < 50_000n * 10n ** 9n) throw new Error("the gift is too small to cover the vault's gas right now");
      say("2/3 depositing into zkAPI's vault (one transaction, about a minute)");
      const amount = formatEther(principal);
      const prepared = await zk.prepareDepositQuote(amount, { from: account.address });
      await zk.deposit(amount, say, { preparedOperationId: prepared.operationId });
      say("3/3 done. Opening the chat.");
      refreshBalance();
      setTimeout(() => router.push("/chat"), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "failed");
    } finally {
      setBusy(false);
    }
  };

  if (!keys) return null;
  if (hasNote) return <Notice tone="tap">This browser already has credits. Spend or withdraw them first; the gift stays in its link.</Notice>;
  if (!state) return <p className="caret text-xs text-muted">reading the gift</p>;
  if (!note) return <Notice tone="burn">This link holds no zipped coins (already claimed, or not funded yet). Ask whoever sent it.</Notice>;
  return (
    <div className="space-y-3 border border-tap/50 p-4">
      <div className="text-sm text-snow">A gift: {Number(formatEther(note.value)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC of private AI chat.</div>
      {!approved && <Notice>The gift is still being vetted by zipcoin&apos;s pool (a few minutes after it was funded). This button turns on by itself.</Notice>}
      <Button className="w-full" disabled={!approved || busy || !zk || !gas || !quote?.online} busy={busy} onClick={claim}>
        Claim my private AI chat
      </Button>
      <p className="text-xs leading-relaxed text-faint">
        Three steps run on their own: the gift becomes ETH on a key that lives only in this browser, that key deposits into zkAPI&apos;s vault, and the chat opens.
        About two minutes. Keep this tab open.
      </p>
      {log.length > 0 && (
        <ol className="space-y-1 text-xs text-muted">
          {log.map((l, i) => (
            <li key={i} className={i === log.length - 1 && busy ? "caret" : ""}>{l}</li>
          ))}
        </ol>
      )}
      {error && <Notice tone="burn">{error}</Notice>}
    </div>
  );
}
