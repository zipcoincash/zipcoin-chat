"use client";

import { useState } from "react";

/** The page threw. Say what, let it be copied, and offer the two ways out that do not lose anything (nothing here is server state). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `${error.name}: ${error.message}\n${error.stack ?? ""}\n${navigator.userAgent}`;
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-10 page-in">
      <h1 className="text-2xl text-snow">Something broke on this page.</h1>
      <p className="text-sm leading-relaxed text-muted">
        Your credits and keys are untouched: they live in this browser&apos;s storage, not on the page. Reload usually fixes a one-off. If it keeps
        happening, copy the error below and send it to @zipcoincash.
      </p>
      <pre className="max-h-64 overflow-auto border border-line bg-night p-4 text-xs text-burn whitespace-pre-wrap break-words">{error.name}: {error.message}{"\n"}{(error.stack ?? "").split("\n").slice(0, 8).join("\n")}</pre>
      <div className="flex flex-wrap gap-2">
        <button className="press h-11 bg-tap px-5 text-sm font-medium text-night" onClick={() => reset()}>Try again</button>
        <button className="press h-11 border border-line px-5 text-sm text-snow" onClick={() => location.reload()}>Reload</button>
        <button className="press h-11 border border-line px-5 text-sm text-snow" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); }}>{copied ? "copied" : "Copy error"}</button>
        <a className="press inline-flex h-11 items-center border border-line px-5 text-sm text-snow" href="/wallet">Wallet / backup</a>
      </div>
    </div>
  );
}
