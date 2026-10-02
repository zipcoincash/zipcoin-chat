"use client";

import { useEffect, useState } from "react";

import { ClaimFlow } from "@/components/claim";
import { DepositCard } from "@/components/deposit";
import { FundWithEth } from "@/components/fund-eth";
import { FundFromNote } from "@/components/fund-note";
import { Card, CardHead, PageHead } from "@/components/ui";
import { useWallet } from "@/components/wallet-ctx";
import { useZipKey } from "@/components/zip-key";

type Tab = "note" | "code" | "eth";

export default function FundPage() {
  const { account, balance } = useWallet();
  const { keys, fromLink } = useZipKey();
  const [tab, setTab] = useState<Tab>("note");
  // A cheque link opened this page: go straight to the code tab with the key already unlocked.
  useEffect(() => {
    if (!keys || window.__zcTabTouched) return;
    const t = setTimeout(() => setTab((cur) => (cur === "note" ? "code" : cur)), 0);
    return () => clearTimeout(t);
  }, [keys]);

  return (
    <div className="space-y-8 page-in">
      <PageHead title="Private AI chat, paid with a zipped note.">
        Fund a fresh address that only this browser controls, deposit it into zkAPI&apos;s vault, and talk to the models directly. No account. No wallet connection. Nothing to log in to.
      </PageHead>

      <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHead title="1. Fund this chat" hint={account ? `address ${account.address.slice(0, 8)}…${balance !== null ? ` · ${(Number(balance) / 1e18).toFixed(5)} ETH` : ""}` : "creating a key…"} />
          <div className="space-y-5 p-5">
            <div className="flex gap-1 rounded-md border border-line p-1 text-sm" role="tablist">
              {(
                [
                  ["note", "zipped note"],
                  ["code", "paste a code"],
                  ["eth", "plain ETH"],
                ] as const
              ).map(([t, l]) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => { window.__zcTabTouched = true; setTab(t); }} className={`flex-1 rounded px-3 py-1.5 ${tab === t ? "bg-raised text-snow" : "text-muted hover:text-snow"}`}>
                  {l}
                </button>
              ))}
            </div>
            {tab === "note" && <FundFromNote mode="wallet" />}
            {tab === "code" && fromLink && <ClaimFlow />}
            {tab === "code" && <FundFromNote mode="phrase" />}
            {tab === "eth" && <FundWithEth />}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHead title="2. Deposit into zkAPI" hint="credits live in this browser" />
            <div className="p-5">
              <DepositCard />
            </div>
          </Card>
          <Card>
            <CardHead title="How it stays private" />
            <ul className="space-y-2 p-5 text-xs leading-relaxed text-muted">
              <li>The funding address is a throwaway key made here. A zipped note reaches it with no link to your deposit; the relayer sees a proof, not you.</li>
              <li>The vault deposit is signed by that key. The chat then proves &ldquo;a funded note&rdquo; to zkAPI&apos;s server and gets a 5-minute capped key; prompts go from your browser to the model provider directly.</li>
              <li>This site never sees prompts, answers, the note or the key. It serves the page and passes prompt-free protocol messages to zkAPI&apos;s server, which does not accept browsers from other origins yet.</li>
              <li>What the provider sees: your prompt text and your IP. Use Tor or a VPN if the IP matters to you.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __zcTabTouched?: boolean;
  }
}
