"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";


import { minFunding, useGas } from "./gas";
import { Addr, fmtEth, Notice } from "./ui";
import { useWallet } from "./wallet-ctx";

/** Plain ETH to the throwaway address. Honest about what it costs in privacy. */
export function FundWithEth() {
  const { account, price } = useWallet();
  const { data: gas } = useGas();
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    QRCode.toDataURL(`ethereum:${account.address}@1`, { margin: 1, width: 220, color: { dark: "#e9eef3", light: "#06080c" } }).then(setQr).catch(() => setQr(null));
  }, [account]);
  const ethUsd = price ? Number(price.answer) / 10 ** price.decimals : 0;
  const minWei = gas && ethUsd ? minFunding(gas, ethUsd) : 0n;
  if (!account) return null;
  return (
    <div className="space-y-4">
      <Notice tone="burn">
        Sending from a wallet you own writes a public link between that wallet and this chat&apos;s address, and from there to the
        vault deposit. The provider still never learns who you are, but the chain does. A zipped note has no such link.
      </Notice>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {qr && <Image src={qr} alt="" width={220} height={220} unoptimized className="border border-line" />}
        <div className="space-y-3 text-sm">
          <div className="text-xs text-faint">Send ETH on Ethereum mainnet to</div>
          <div className="break-all font-mono text-snow">{account.address}</div>
          <Addr a={account.address} />
          <p className="text-xs leading-relaxed text-muted">
            Send at least ≈ {minWei ? `${fmtEth(minWei)} ETH ($${(Number(minWei) / 1e18 * ethUsd).toFixed(0)})` : "…"} so the vault&apos;s gas stays a small share. The balance appears
            here within a block; then deposit it below.
          </p>
        </div>
      </div>
    </div>
  );
}
