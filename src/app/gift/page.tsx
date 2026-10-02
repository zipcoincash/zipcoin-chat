"use client";

import { useQuery } from "@tanstack/react-query";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, formatUnits, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";

import { minFunding, useGas } from "@/components/gas";
import { Button, Card, CardHead, Field, inputCls, Notice, PageHead, Receipt, TxLink } from "@/components/ui";
import { useWallet } from "@/components/wallet-ctx";
import { fetchStats, quoteZcToEth } from "@/lib/api";
import { ADDR, RPC_URL, SITE_URL } from "@/lib/config";
import { POOLS } from "@/lib/pools";
import { hashPrecommitment } from "@/lib/tree";
import { depositSecrets, masterKeys } from "@/lib/zip";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
type Gift = { phrase: string; link: string; tx?: Hex; status: "new" | "sent" | "funded" | "failed" };
const STORE = "zc-gifts-v1";
const abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)",
]);
const linkFor = (phrase: string) => `${SITE_URL}/#phrase=${phrase.split(" ").join("-")}`;

/**
 * Gift links: each link is a fresh zip phrase holding one ZC note in zipcoin's pool. Opening it on this site claims the note
 * into a private AI chat with one button. Funding is public (your wallet → the pool); the chats it pays for are not linked to it.
 */
export default function GiftPage() {
  const { price } = useWallet();
  const { data: gas } = useGas();
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats, refetchInterval: 30_000 });
  const [count, setCount] = useState(5);
  const [zcEach, setZcEach] = useState("");
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [zcBal, setZcBal] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ethUsd = price ? Number(price.answer) / 10 ** price.decimals : (stats?.ethUsd ?? 0);
  const usdPerZc = stats ? stats.ethPerZc * ethUsd : 0;
  // Smallest gift worth giving: what a chat needs after the vault's gas, plus zipcoin's fees and vetting, with margin.
  const minWei = gas && ethUsd ? minFunding(gas, ethUsd) : 0n;
  const minZc = usdPerZc && minWei ? Math.ceil(((Number(formatEther(minWei)) * ethUsd) / usdPerZc) * 1.08 / 100) * 100 : 0;
  const suggestedZc = minZc ? Math.ceil((minZc * 1.5) / 100) * 100 : 0;
  // Default the amount once the live suggestion exists; the user's own value is never overwritten.
  const shownZc = zcEach || (suggestedZc ? String(suggestedZc) : "");
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE) ?? "[]") as Gift[];
        if (saved.length) setGifts(saved);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (gifts.length) localStorage.setItem(STORE, JSON.stringify(gifts));
  }, [gifts]);

  let amount = 0n;
  try {
    amount = shownZc ? parseUnits(shownZc, 18) : 0n;
  } catch {}
  const total = amount * BigInt(count || 0);
  const { data: ethOut } = useQuery({ queryKey: ["gift-eth", amount.toString()], queryFn: () => quoteZcToEth((amount * 985n) / 1000n), enabled: amount > 0n, refetchInterval: 20_000 });
  const perGiftEth = ethOut ? BigInt(ethOut.eth) : 0n;
  const perGiftCreditsEth = gas && perGiftEth > gas.reserve ? perGiftEth - gas.reserve : 0n;
  const tooSmall = amount > 0n && minZc > 0 && Number(shownZc) < minZc;

  const pub = useMemo(() => createPublicClient({ chain: mainnet, transport: http(RPC_URL) }), []);
  const injected = () => (typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null : null);

  const connect = async () => {
    const eth = injected();
    if (!eth) return setError("no wallet extension found");
    setError(null);
    try {
      const [a] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
      setWallet(a);
      setZcBal(await pub.readContract({ address: ADDR.zc, abi, functionName: "balanceOf", args: [a] }));
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "wallet refused");
    }
  };

  const make = () => {
    const fresh: Gift[] = Array.from({ length: count }, () => {
      const phrase = entropyToMnemonic(crypto.getRandomValues(new Uint8Array(16)), wordlist);
      return { phrase, link: linkFor(phrase), status: "new" };
    });
    setGifts((g) => [...fresh, ...g]);
  };

  const fund = async () => {
    const eth = injected();
    if (!eth || !wallet || amount <= 0n) return;
    const todo = gifts.filter((g) => g.status === "new" || g.status === "failed");
    if (!todo.length) return;
    setError(null);
    const wc = createWalletClient({ account: wallet, chain: mainnet, transport: custom(eth) });
    try {
      const need = amount * BigInt(todo.length);
      const allowance = await pub.readContract({ address: ADDR.zc, abi, functionName: "allowance", args: [wallet, ADDR.entrypoint] });
      if (allowance < need) {
        setBusy(`approve ${formatUnits(need, 18)} ZC in your wallet`);
        const h = await wc.writeContract({ address: ADDR.zc, abi, functionName: "approve", args: [ADDR.entrypoint, need] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      for (let i = 0; i < todo.length; i++) {
        const g = todo[i];
        setBusy(`deposit ${i + 1} of ${todo.length}: confirm in your wallet`);
        const k = masterKeys(g.phrase);
        const { nullifier, secret } = depositSecrets(k, POOLS.zc.scope, 0n);
        const pre = hashPrecommitment(nullifier, secret);
        try {
          const h = await wc.writeContract({ address: ADDR.entrypoint, abi, functionName: "deposit", args: [ADDR.zc, amount, pre] });
          setGifts((all) => all.map((x) => (x.phrase === g.phrase ? { ...x, tx: h, status: "sent" } : x)));
          const r = await pub.waitForTransactionReceipt({ hash: h });
          setGifts((all) => all.map((x) => (x.phrase === g.phrase ? { ...x, status: r.status === "success" ? "funded" : "failed" } : x)));
        } catch (e) {
          setGifts((all) => all.map((x) => (x.phrase === g.phrase ? { ...x, status: "failed" } : x)));
          throw e;
        }
      }
      setZcBal(await pub.readContract({ address: ADDR.zc, abi, functionName: "balanceOf", args: [wallet] }));
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "funding stopped");
    } finally {
      setBusy(null);
    }
  };

  const funded = gifts.filter((g) => g.status === "funded");
  const text = (list: Gift[]) => list.map((g) => g.link).join("\n");
  const download = () => {
    const blob = new Blob([`${text(funded)}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zipcoin-chat-gifts-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-8 page-in">
      <PageHead title="Give private AI chats.">
        Each link is a zipped note. Whoever opens it gets a private AI chat in one click, paid by you, not linked to you or to them. Share links with people who want them; never push them.
      </PageHead>
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <Card>
          <CardHead title="1. Size the gifts" hint="live, from gas and the ZC price" />
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="How many links"><input className={inputCls} type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></Field>
              <Field label="ZC per gift" hint={minZc ? `min ≈ ${minZc.toLocaleString()}` : undefined}><input className={inputCls} inputMode="numeric" value={shownZc} onChange={(e) => setZcEach(e.target.value.replace(/[^0-9]/g, ""))} /></Field>
            </div>
            <Receipt
              title="Each gift"
              tone="muted"
              rows={[
                ["ZC zipped", amount ? `${Number(shownZc).toLocaleString()} ZC (${usdPerZc ? `$${(Number(shownZc) * usdPerZc).toFixed(2)}` : "—"})` : "—"],
                ["After vetting + relay fee, as ETH", perGiftEth ? `≈ ${Number(formatEther(perGiftEth)).toFixed(4)} ETH ($${(Number(formatEther(perGiftEth)) * ethUsd).toFixed(2)})` : "—"],
                ["Vault gas kept on the key", gas ? `≈ ${Number(formatEther(gas.reserve)).toFixed(4)} ETH ($${(Number(formatEther(gas.reserve)) * ethUsd).toFixed(2)})` : "—"],
                ["Chat credits they get", perGiftCreditsEth ? `≈ $${(Number(formatEther(perGiftCreditsEth)) * ethUsd).toFixed(2)}` : "—"],
                ["Total ZC for all links", total ? `${Number(formatUnits(total, 18)).toLocaleString()} ZC` : "—"],
              ]}
              caption="zkAPI's vault deposit costs about 6.7M gas and the recipient's key pays it; keep gifts big enough that it stays a small share. Credits expire 30 days after the recipient deposits."
            />
            {tooSmall && <Notice tone="burn">Too small: the vault&apos;s gas would eat the gift. Use at least {minZc.toLocaleString()} ZC.</Notice>}
          </div>
        </Card>
        <Card>
          <CardHead title="2. Make and fund the links" hint={wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}${zcBal !== null ? ` · ${Number(formatUnits(zcBal, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC` : ""}` : "your wallet pays"} />
          <div className="space-y-4 p-5">
            {!wallet ? (
              <Button className="w-full" onClick={connect}>Connect the wallet that holds the ZC</Button>
            ) : zcBal !== null && zcBal < total ? (
              <Notice tone="burn">
                This wallet holds {Number(formatUnits(zcBal, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 })} ZC; the links need {Number(formatUnits(total, 18)).toLocaleString()}. Buy ZC on{" "}
                <a className="underline" href={`https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${ADDR.zc}`} target="_blank" rel="noreferrer">Uniswap</a> first.
              </Notice>
            ) : null}
            <div className="flex gap-2">
              <Button tone="ghost" className="flex-1" onClick={make} disabled={!!busy || amount <= 0n || tooSmall}>Make {count} link{count > 1 ? "s" : ""}</Button>
              <Button className="flex-1" onClick={fund} disabled={!wallet || !!busy || amount <= 0n || tooSmall || !gifts.some((g) => g.status === "new" || g.status === "failed")} busy={!!busy}>
                Fund {gifts.filter((g) => g.status === "new" || g.status === "failed").length || ""} unfunded
              </Button>
            </div>
            {busy && <p className="caret text-xs text-muted">{busy}</p>}
            {error && <Notice tone="burn">{error}</Notice>}
            <Notice tone="burn">
              Save the links before you fund them: they are the only key to the coins. They are kept in this browser too, but a cleared browser forgets them. A funded link works about five minutes after its deposit (vetting).
            </Notice>
          </div>
        </Card>
      </div>

      {gifts.length > 0 && (
        <Card>
          <CardHead
            title={`Links (${funded.length} funded of ${gifts.length})`}
            right={
              <span className="flex gap-3 text-xs">
                <button className="text-muted hover:text-snow" onClick={() => { navigator.clipboard.writeText(text(funded.length ? funded : gifts)); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? "copied" : `copy ${funded.length ? "funded" : "all"}`}</button>
                <button className="text-muted hover:text-snow" onClick={download} disabled={!funded.length}>download funded</button>
                <button className="text-muted hover:text-burn" onClick={() => { if (confirm("Forget these links in this browser? Unfunded ones are gone for good; funded ones you must have saved.")) { setGifts([]); localStorage.removeItem(STORE); } }}>forget</button>
              </span>
            }
          />
          <ul className="divide-y divide-line text-xs">
            {gifts.map((g) => (
              <li key={g.phrase} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0 truncate font-mono text-muted">{g.link}</span>
                <span className="flex shrink-0 items-center gap-3">
                  {g.tx && <TxLink hash={g.tx} />}
                  <span className={g.status === "funded" ? "text-tap" : g.status === "failed" ? "text-burn" : "text-faint"}>{g.status === "new" ? "not funded" : g.status}</span>
                  <button className="text-muted hover:text-snow" onClick={() => navigator.clipboard.writeText(g.link)}>copy</button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
