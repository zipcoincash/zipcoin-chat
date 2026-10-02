"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { keccak256, numberToHex, stringToHex, type Hex } from "viem";

import { isMnemonic, masterKeys, mnemonicFromSignature, ZIP_MESSAGE, type MasterKeys } from "@/lib/zip";

import { Button, Info, inputCls, Notice } from "./ui";

type ZipKey = {
  mnemonic: string | null;
  keys: MasterKeys | null;
  fingerprint: string | null;
  /** Derive the key from a wallet signature (injected wallet). A message, not a transaction: nothing goes on chain. */
  unlockWithWallet: () => Promise<void>;
  usePhrase: (p: string) => boolean;
  lock: () => void;
  busy: boolean;
  error: string | null;
  hasInjected: boolean;
  /** The phrase arrived in the URL fragment (a gift / cheque link). */
  fromLink: boolean;
};

const Ctx = createContext<ZipKey | null>(null);

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const injected = () => (typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null : null);

/** A zipped cheque: `#phrase=<12 words>` (spaces or dashes) in the URL fragment, which browsers never send to any server. */
export function phraseFromFragment(): string | null {
  if (typeof window === "undefined") return null;
  const m = /[#&]phrase=([^&]+)/.exec(window.location.hash);
  if (!m) return null;
  const p = decodeURIComponent(m[1]).replace(/[-+_]/g, " ").trim().toLowerCase().split(/\s+/).join(" ");
  return isMnemonic(p) ? p : null;
}

export function ZipKeyProvider({ children }: { children: ReactNode }) {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInjected, setHasInjected] = useState(false);
  const [fromLink, setFromLink] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setHasInjected(!!injected());
      const p = phraseFromFragment();
      if (p) {
        setMnemonic(p);
        setFromLink(true);
        // Drop the cheque from the address bar so it does not linger in history.
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const keys = useMemo(() => (mnemonic ? masterKeys(mnemonic) : null), [mnemonic]);
  const fingerprint = useMemo(() => (keys ? keccak256(numberToHex(keys.masterNullifier, { size: 32 })).slice(2, 10) : null), [keys]);

  const value: ZipKey = {
    mnemonic,
    keys,
    fingerprint,
    busy,
    error,
    hasInjected,
    fromLink,
    unlockWithWallet: async () => {
      const eth = injected();
      if (!eth) return setError("no wallet extension found; paste a zip phrase instead");
      setError(null);
      setBusy(true);
      try {
        const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
        const sig = (await eth.request({ method: "personal_sign", params: [stringToHex(ZIP_MESSAGE), addr] })) as Hex;
        setMnemonic(mnemonicFromSignature(sig));
      } catch (e) {
        setError(e instanceof Error ? e.message.split("\n")[0] : "signature rejected");
      } finally {
        setBusy(false);
      }
    },
    usePhrase: (p) => {
      const clean = p.trim().toLowerCase().split(/\s+/).join(" ");
      if (!isMnemonic(clean)) {
        setError("that is not a valid 12 word zip phrase");
        return false;
      }
      setError(null);
      setMnemonic(clean);
      return true;
    },
    lock: () => {
      setMnemonic(null);
      setFromLink(false);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useZipKey() {
  const v = useContext(Ctx);
  if (!v) throw new Error("ZipKeyProvider missing");
  return v;
}

export function ZipKeyPanel({ mode }: { mode: "wallet" | "phrase" }) {
  const zk = useZipKey();
  const [phrase, setPhrase] = useState("");

  if (zk.keys)
    return (
      <div className="flex items-center justify-between gap-3 border border-line bg-night px-4 py-3 text-sm">
        <span className="flex items-center gap-3">
          <span className="tap-ring inline-block h-3 w-3 rounded-full" />
          zip key <span className="text-tap">{zk.fingerprint}</span>
        </span>
        <button className="text-xs text-muted hover:text-snow" onClick={zk.lock}>
          lock
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      {mode === "wallet" ? (
        <>
          <Button className="w-full" onClick={zk.unlockWithWallet} busy={zk.busy} disabled={!zk.hasInjected}>
            {zk.hasInjected ? "Unlock zip key with a wallet signature" : "No wallet extension found"}
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-faint">
            A signature, not a transaction; nothing is sent anywhere.
            <Info label="How does this work?">The same message zipcoin.cash asks you to sign. The signature becomes your zip key here in the browser, so you see the notes you zipped there. Signing a message costs nothing and leaves no trace on chain, so your wallet is not linked to this chat.</Info>
          </p>
        </>
      ) : (
        <>
          <textarea
            className={`${inputCls} h-20 resize-none text-sm`}
            placeholder="twelve words: your zip phrase, or the code someone gave you"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button tone="ghost" className="w-full" onClick={() => zk.usePhrase(phrase) && setPhrase("")}>
            Use this code
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-faint">
            The words stay in this tab.
            <Info label="How does this work?">A zipped cheque or gift link (#phrase=…) works the same way: the part after # never leaves your browser. The twelve words are turned into your note keys here, and the proof that spends a note is built here too.</Info>
          </p>
        </>
      )}
      {zk.error && <Notice tone="burn">{zk.error}</Notice>}
    </div>
  );
}
