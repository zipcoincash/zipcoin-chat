"use client";

/** Last resort when the root layout itself fails. Plain HTML: no theme, no providers. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ background: "#06080c", color: "#e9eef3", fontFamily: "ui-monospace, monospace", padding: 32 }}>
        <h1 style={{ fontSize: 20 }}>Something broke.</h1>
        <p style={{ color: "#8993a2", fontSize: 14 }}>Your credits and keys are untouched (they live in this browser&apos;s storage). Copy this and send it to @zipcoincash:</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid #1d2531", padding: 16, fontSize: 12, color: "#ff7a45" }}>{error.name}: {error.message}{"\n"}{(error.stack ?? "").split("\n").slice(0, 8).join("\n")}</pre>
        <button onClick={() => location.reload()} style={{ background: "#3ddc84", color: "#06080c", border: 0, padding: "12px 20px", fontSize: 14 }}>Reload</button>
      </body>
    </html>
  );
}
