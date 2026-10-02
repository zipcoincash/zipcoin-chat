"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ZIPCOIN_URL } from "@/lib/config";

import { useWallet } from "./wallet-ctx";

const NAV = [
  ["/", "fund"],
  ["/chat", "chat"],
  ["/wallet", "wallet"],
  ["/gift", "gift"],
  ["/privacy", "privacy"],
] as const;

export function Header() {
  const path = usePathname();
  const { snapshot, price } = useWallet();
  const note = snapshot?.wallet?.note ?? null;
  const usd = note && price ? (Number(note.current_balance) / 1e9) * (Number(price.answer) / 10 ** price.decimals) : null;
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-5">
        <div className="flex items-center gap-3">
          <a href={ZIPCOIN_URL} className="flex items-center" aria-label="zipcoin">
            <Image src="/wordmark.png" alt="zipcoin" width={92} height={30} priority />
          </a>
          <span className="text-xs text-faint">chat</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={path === href ? "text-snow" : "text-muted hover:text-snow"}>
              {label}
            </Link>
          ))}
          {note && (
            <Link href="/wallet" className="hidden items-center gap-2 border border-line px-3 py-1 text-xs sm:flex">
              <span className="tap-ring inline-block h-2 w-2 rounded-full" />
              {usd !== null ? `$${usd.toFixed(2)}` : `${(Number(note.current_balance) / 1e9).toFixed(5)} ETH`}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
