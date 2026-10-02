"use client";

import { useState } from "react";
import { isAddress } from "viem";

import { Addr, Button, Card, CardHead, Field, fmtEth, inputCls, Notice, PageHead, Receipt } from "@/components/ui";
import { useWallet, useZkapiClient } from "@/components/wallet-ctx";
import { exportBackup, importBackup } from "@/lib/throwaway";
import { humanize } from "@/lib/zkapi";

export default function WalletPage() {
  const { account, balance, snapshot, price, refreshBalance, reloadKey } = useWallet();
  const client = useZkapiClient();
  const note = snapshot?.wallet?.note ?? null;
  const ethUsd = price ? Number(price.answer) / 10 ** price.decimals : 0;

  // backup
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [bkError, setBkError] = useState<string | null>(null);
  const [bkDone, setBkDone] = useState<string | null>(null);
  const exportNow = async () => {
    setBkError(null);
    setBkDone(null);
    if (pass.length < 8) return setBkError("use a passphrase of at least 8 characters");
    if (pass !== pass2) return setBkError("the two passphrases differ");
    try {
      const json = await exportBackup(pass);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `zipcoin-chat-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setBkDone("exported");
    } catch (e) {
      setBkError(e instanceof Error ? e.message : "export failed");
    }
  };
  const importNow = async (file: File) => {
    setBkError(null);
    setBkDone(null);
    if (note) return setBkError("this browser already holds credits; importing would overwrite them. Withdraw or spend them first.");
    if (!pass) return setBkError("enter the backup's passphrase first");
    try {
      await importBackup(await file.text(), pass);
      await reloadKey();
      setBkDone("imported. Reloading…");
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      setBkError(e instanceof Error ? e.message : "import failed");
    }
  };

  // withdraw
  const [dest, setDest] = useState("");
  const [mode, setMode] = useState<"mutual" | "escape">("mutual");
  const [log, setLog] = useState<string[]>([]);
  const [wBusy, setWBusy] = useState(false);
  const [wError, setWError] = useState<string | null>(null);
  const withdraw = async () => {
    if (!client || !isAddress(dest)) return;
    setWBusy(true);
    setWError(null);
    setLog([]);
    try {
      await client.withdraw(mode, (raw) => { const s = humanize(raw); setLog((l) => (l[l.length - 1] === s ? l : [...l, s])); }, { destination: dest });
      refreshBalance();
    } catch (e) {
      setWError(e instanceof Error ? e.message.split("\n")[0] : "withdrawal failed");
    } finally {
      setWBusy(false);
    }
  };
  const sync = async () => {
    if (!client) return;
    setWBusy(true);
    try {
      await client.syncWithdrawal((s) => setLog((l) => [...l, humanize(s)]));
      await client.syncEscapeWithdrawals((s) => setLog((l) => [...l, humanize(s)]));
    } catch (e) {
      setWError(e instanceof Error ? e.message.split("\n")[0] : "sync failed");
    } finally {
      setWBusy(false);
    }
  };
  const pendingWithdrawals = (snapshot?.withdrawals ?? []).filter((w) => !["closed", "detached", "reverted", "challenged", "superseded", "quarantined"].includes(w.status));

  return (
    <div className="space-y-8 page-in">
      <PageHead title="Wallet">This browser holds two secrets: the throwaway key that funded the chat and the zkAPI note that holds the credits. Both live in this site&apos;s storage and nowhere else.</PageHead>

      <Notice tone="burn">Clearing this site&apos;s data, a private window closing, or a browser reset loses the credits for good. Export a backup now and keep it with its passphrase.</Notice>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHead title="Balances" />
          <div className="p-5">
            <Receipt
              title="Where the money is"
              tone="muted"
              rows={[
                ["Credits in the vault", note ? `${(Number(note.current_balance) / 1e9).toFixed(6)} ETH${ethUsd ? ` ($${((Number(note.current_balance) / 1e9) * ethUsd).toFixed(2)})` : ""}` : "none"],
                ["Credits expire", note ? new Date(note.expiry_ts * 1000).toLocaleString() : "—"],
                ["ETH on the funding address (gas reserve)", balance === null ? "…" : `${fmtEth(balance)} ETH`],
                ["Funding address", account ? <Addr key="a" a={account.address} /> : "…"],
              ]}
              caption="Expired credits go to zkAPI's operator. The gas reserve pays this address's own transactions (the deposit and a close); whatever is left after a close can be sent anywhere with the key in the backup."
            />
          </div>
        </Card>

        <Card>
          <CardHead title="Backup" hint="encrypted file, your passphrase" />
          <div className="space-y-3 p-5">
            <Field label="Passphrase"><input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Again (export only)"><input type="password" className={inputCls} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={exportNow} disabled={!account}>Export</Button>
              <label className="press flex h-11 flex-1 cursor-pointer items-center justify-center border border-line text-sm text-snow hover:border-muted">
                Import
                <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importNow(e.target.files[0])} />
              </label>
            </div>
            {bkError && <Notice tone="burn">{bkError}</Notice>}
            {bkDone && <Notice tone="tap">{bkDone}</Notice>}
            <p className="text-xs leading-relaxed text-faint">AES-GCM with a key derived from your passphrase (PBKDF2, 600k rounds). The file holds the throwaway key and zkAPI&apos;s wallet database. Import into a browser with no credits of its own; never into two browsers at once (the note would double-spend and fail).</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Withdraw leftovers" hint="unused credits back to an address" />
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Destination" hint="any address; a fresh one keeps the chat unlinked"><input className={inputCls} placeholder="0x…" value={dest} onChange={(e) => setDest(e.target.value.trim())} spellCheck={false} /></Field>
            <div className="flex gap-1 rounded-md border border-line p-1 text-xs">
              {(["mutual", "escape"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded px-3 py-1.5 ${mode === m ? "bg-raised text-snow" : "text-muted hover:text-snow"}`}>{m === "mutual" ? "cooperative close (now)" : `escape (${snapshot ? Math.round(snapshot.challengePeriodSeconds / 3600) : 24}h)`}</button>
              ))}
            </div>
            <Button className="w-full" disabled={!client || !note || !isAddress(dest) || wBusy} busy={wBusy} onClick={withdraw}>{mode === "mutual" ? "Close and withdraw" : "Start escape"}</Button>
            {pendingWithdrawals.length > 0 && <Button tone="ghost" className="w-full" onClick={sync} disabled={wBusy}>Check / finalize pending withdrawal</Button>}
            {log.length > 0 && <ol className="space-y-1 text-xs text-muted">{log.map((l, i) => <li key={i}>{l}</li>)}</ol>}
            {wError && <Notice tone="burn">{wError}</Notice>}
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-muted">
            <p><span className="text-snow">Cooperative close</span> asks zkAPI&apos;s server for a signed clearance and closes the note in one transaction, paid by this chat&apos;s funding address from its gas reserve (about as much gas as the deposit).</p>
            <p><span className="text-snow">Escape</span> needs no cooperation: one transaction starts it, the challenge period passes, a second finalizes it. Keep this browser; the second step runs from here.</p>
            <p>If the reserve is short because gas rose, send a little ETH to the funding address above and retry.</p>
            {pendingWithdrawals.map((w, i) => (
              <p key={i} className="text-faint">pending: {w.mode} · {w.status}{w.transactionHash ? ` · ${w.transactionHash.slice(0, 10)}…` : ""}</p>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
