"use client";

import Link from "next/link";
import { useState } from "react";
import { formatEther, formatUnits } from "viem";

import { ADDR } from "@/lib/config";

import { humanize } from "@/lib/zkapi";

import { useGas } from "./gas";
import { Addr, Button, fmtEth, Notice, Receipt, TxLink } from "./ui";
import { useWallet, useZkapiClient } from "./wallet-ctx";

/**
 * Turn the ETH on the throwaway address into a zkAPI note. The SDK prepares the note secret in its worker, we size the
 * principal so the key keeps enough for this deposit's gas and one later close, and the throwaway signs the vault call.
 */
export function DepositCard() {
  const { account, balance, price, snapshot, sdkError, refreshBalance } = useWallet();
  const client = useZkapiClient();
  const { data: gas } = useGas();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const note = snapshot?.wallet?.note ?? null;
  const pending = snapshot?.config?.pending_deposit ?? null;
  const ethUsd = price ? Number(price.answer) / 10 ** price.decimals : 0;
  const usd = (wei: bigint) => (ethUsd ? `$${(Number(formatEther(wei)) * ethUsd).toFixed(2)}` : "—");
  const reserve = gas?.reserve ?? 0n;
  // Whole gwei only: the vault's ledger unit.
  const principalWei = balance && balance > reserve ? ((balance - reserve) / 10n ** 9n) * 10n ** 9n : 0n;
  const ethAmount = formatEther(principalWei);
  const minUnits = 50_000n * 10n ** 9n;

  const deposit = async () => {
    if (!client || !account || principalWei < minUnits) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setLog([]);
    const say = (raw: string) => {
      const s = humanize(raw);
      setLog((l) => (l[l.length - 1] === s ? l : [...l, s]));
    };
    try {
      say("preparing the note in the worker");
      const prepared = await client.prepareDepositQuote(ethAmount, { from: account.address });
      say(`commitment ${prepared.commitment.slice(0, 14)}…`);
      const result = (await client.deposit(ethAmount, say, { preparedOperationId: prepared.operationId })) as { transactionHash?: string } | null;
      setDone(result?.transactionHash ?? "done");
      refreshBalance();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "deposit failed");
    } finally {
      setBusy(false);
    }
  };

  /**
   * A deposit that did not finish: the SDK knows exactly where it stands (mined, reverted, still pending, slot taken by another
   * deposit). Ask it, narrate the state, and only when it says the plan is safe to retry send the same deposit again (it rebases
   * the Merkle path itself). A vault deposit reverts if any other vault transaction lands between path computation and inclusion;
   * the SDK waits for chain finality before trusting that a slot is really gone.
   */
  const resume = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setLog([]);
    const say = (raw: string) => {
      const s = humanize(raw);
      setLog((l) => (l[l.length - 1] === s ? l : [...l, s]));
    };
    try {
      const r = await client.recoverBrowserDeposit(say);
      const status = r?.status ?? "prepared";
      if (status === "confirmed") {
        setDone("recovered");
        refreshBalance();
        return;
      }
      if (status === "submitted") {
        say(`the deposit transaction is still in flight${r?.transactionHash ? ` (${r.transactionHash.slice(0, 12)}…)` : ""}. Wait for it, then press Resume again.`);
        return;
      }
      if (status === "slot_conflict_unconfirmed") {
        say("another deposit took this slot in the meantime. The vault needs chain finality (about 13 minutes) before the plan can be rebuilt safely. Press Resume again later; nothing is lost.");
        return;
      }
      if (status === "dropped_or_pending") {
        say("the transaction has no receipt yet (dropped or still pending). Press Resume again in a minute.");
        return;
      }
      if (status === "ambiguous") {
        say("the wallet did not report a transaction id. Checking what the chain says…");
        const retry = (await client.prepareDepositRetry(say)) as { status?: string } | null;
        if (retry?.status === "confirmed") {
          setDone("recovered");
          refreshBalance();
          return;
        }
      }
      // slot_consumed / prepared / retry_exact: the SDK has a plan it considers safe; re-send it.
      const amount = pending?.amount ? formatUnits(BigInt(pending.amount), 9) : ethAmount;
      say("rebuilding the deposit against the current vault state");
      const result = (await client.deposit(amount, say)) as { transactionHash?: string } | null;
      setDone(result?.transactionHash ?? "done");
      refreshBalance();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "recovery failed");
    } finally {
      setBusy(false);
    }
  };

  if (sdkError) return <Notice tone="burn">zkAPI SDK: {sdkError}</Notice>;
  if (!snapshot) return <p className="caret text-xs text-muted">starting the zkAPI wallet (worker, config, manifest checks)</p>;
  if (note)
    return (
      <div className="space-y-3">
        <Receipt
          title="Credits ready"
          rows={[
            ["Balance", `${(Number(note.current_balance) / 1e9).toFixed(6)} ETH${ethUsd ? ` ($${((Number(note.current_balance) / 1e9) * ethUsd).toFixed(2)})` : ""}`],
            ["Expires", new Date(note.expiry_ts * 1000).toLocaleString()],
            ["Note", `#${note.note_id}`],
          ]}
          caption="One note per browser: zkAPI's wallet holds one active balance. Spend it, or withdraw it from /wallet, before funding again."
        />
        <Link href="/chat" className="press inline-flex h-11 items-center bg-tap px-5 text-sm font-medium text-night">Open the chat</Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <Receipt
        title="Deposit into the zkAPI vault"
        tone="muted"
        rows={[
          ["This chat's funding address", account ? <Addr key="a" a={account.address} /> : "…"],
          ["On it now", balance === null ? "…" : `${fmtEth(balance)} ETH (${usd(balance)})`],
          ["Kept for gas: this deposit + one close", gas ? `${fmtEth(reserve)} ETH (${usd(reserve)}) at ${(Number(gas.price) / 1e9).toFixed(2)} gwei` : "…"],
          ["Deposited as credits", principalWei > 0n ? `${fmtEth(principalWei)} ETH (${usd(principalWei)})` : "—"],
          ["Vault", <span key="v" className="font-mono text-xs">{ADDR.zkapiVault}</span>],
        ]}
        caption="The deposit is one transaction from this address to zkAPI's vault (about 6.7M gas: 64 Poseidon hashes on chain). Credits expire 30 days after the deposit; the vault owner can pause it; the circuit setup is single-party and unaudited (their words). Keep it small."
      />
      {pending && !busy && (
        <Notice>
          A previous deposit is unfinished ({pending.phase ?? "pending"}, {pending.amount ? `${formatUnits(BigInt(pending.amount), 9)} ETH` : "amount unknown"}
          {pending.transaction_hash ? <>, tx <TxLink hash={pending.transaction_hash} /></> : ""}). Nothing is lost: the ETH is still on this chat&apos;s address unless the
          transaction mined. Press Resume; the wallet checks the chain and either recovers the note or rebuilds the deposit.
        </Notice>
      )}
      {balance !== null && balance > 0n && principalWei < minUnits && <Notice tone="burn">Not enough on the address yet: the gas reserve alone is {fmtEth(reserve)} ETH right now. Fund more, or wait for cheaper gas.</Notice>}
      <Button className="w-full" disabled={!client || busy || (pending ? false : principalWei < minUnits)} busy={busy} onClick={pending ? resume : deposit}>
        {pending ? "Resume the deposit" : "Deposit into the vault"}
      </Button>
      {log.length > 0 && (
        <ol className="space-y-1 text-xs text-muted">
          {log.map((l, i) => (
            <li key={i} className={i === log.length - 1 && busy ? "caret" : ""}>{l}</li>
          ))}
        </ol>
      )}
      {error && <Notice tone="burn">{error}</Notice>}
      {done && (
        <Notice tone="tap">
          Deposited{done.startsWith("0x") ? <> (<TxLink hash={done} />)</> : ""}. <Link href="/chat" className="underline">Open the chat</Link>. Then back it up on /wallet: this browser&apos;s storage is the only copy.
        </Notice>
      )}
    </div>
  );
}
