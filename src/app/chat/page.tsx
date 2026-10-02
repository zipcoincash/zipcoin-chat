"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import { PublishToBook } from "@/components/publish";
import { Button, Card, CardHead, inputCls, Notice } from "@/components/ui";
import { useWallet, useZkapiClient } from "@/components/wallet-ctx";
import { gather, QUESTIONS, type Gathered, type QuestionKind } from "@/lib/onchain";
import { mentionsZipcoin, zipcoinFacts } from "@/lib/zipcoin-facts";
import { type Access, type Tier } from "@/lib/zkapi";

/** `context` is on-chain data gathered in the browser for a crypto question: sent to the model, shown only as a summary. */
type Msg = { role: "user" | "assistant"; content: string; context?: string; summary?: string };
type Model = { id: string; name: string; pricing?: { prompt: string; completion: string }; context_length?: number; top_provider?: { max_completion_tokens?: number | null } | null };
type Usage = { prompt_tokens: number; completion_tokens: number; cost?: number };

const STORE = "zc-chat-v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
/** One cap for every key. OA's org issues $1 child keys today and refuses larger ones; a refused request locks the note on their
 *  side, so the choice is not offered. Keys renew automatically when they expire, so $1 covers long chats. */
const KEY_CAP = (Number(process.env.NEXT_PUBLIC_KEY_CAP_USD ?? "1") || 1) as Tier;
const SESSION = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());

/** OpenRouter's public catalog: the models the issued key can address. Which ones OA's org allows is theirs to decide; a refused model fails loudly. */
function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const r = await fetch("https://openrouter.ai/api/v1/models");
      if (!r.ok) throw new Error(`models ${r.status}`);
      const j = (await r.json()) as { data: Model[] };
      return (j.data ?? []).filter((m) => m && typeof m.id === "string" && m.pricing && Number(m.pricing.prompt) >= 0).sort((a, b) => a.id.localeCompare(b.id));
    },
    staleTime: 60 * 60_000,
  });
}

const perM = (s?: string) => (s ? `$${(Number(s) * 1e6).toFixed(2)}/M` : "—");

type Stuck = { capUsd: string; since: string; status: string; id: string };
/**
 * When the SDK reports a pending request and no live key, look at what it is waiting for: the journaled request (read-only, from
 * the SDK's own database in this browser) and the server's view of it. Shown to the user in plain words; nothing is changed.
 */
function useStuckRequest(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["stuck"],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Stuck | null> => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const q = indexedDB.open("zkapi-browser-wallet-v1");
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      try {
        if (!db.objectStoreNames.contains("runtime")) return null;
        const t = db.transaction("runtime", "readonly");
        const rt = (await new Promise<{ journal?: { prepared_request?: { client_request_id?: string; public_inputs?: { solvency_bound?: number | string }; payload?: string } } } | undefined>((res, rej) => {
          const q = t.objectStore("runtime").get("active");
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        }));
        const req = rt?.journal?.prepared_request;
        if (!req?.client_request_id) return null;
        let answer = 0;
        try {
          const quote = JSON.parse(req.payload ?? "{}") as { billing_quote?: { answer?: string; decimals?: number } };
          answer = quote.billing_quote?.answer ? Number(quote.billing_quote.answer) / 10 ** (quote.billing_quote.decimals ?? 8) : 0;
        } catch {}
        const capUsd = answer ? ((Number(req.public_inputs?.solvency_bound ?? 0) / 1e9) * answer).toFixed(2) : "?";
        const r = await fetch(`/zkapi-deployment/v2/openrouter/leases/${encodeURIComponent(req.client_request_id)}`, { cache: "no-store", credentials: "omit" });
        const j = r.ok ? ((await r.json()) as { status?: string; issued_at?: number }) : { status: `unknown (${r.status})` };
        // Only a lease OA never provisioned is "stuck". Active, retiring or finalized leases are the SDK's normal business.
        if (j.status !== "provisioning") return null;
        return { capUsd, since: j.issued_at ? new Date(j.issued_at * 1000).toLocaleTimeString() : "earlier", status: j.status ?? "unknown", id: req.client_request_id };
      } finally {
        db.close();
      }
    },
  });
  return enabled ? (data ?? null) : null;
}

export default function ChatPage() {
  const { snapshot, price, sdkError } = useWallet();
  const client = useZkapiClient();
  const { data: models } = useModels();
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [filter, setFilter] = useState("");
  const tier: Tier = KEY_CAP;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ prompt: number; completion: number; cost: number; requests: number }>({ prompt: 0, completion: 0, cost: 0, requests: 0 });
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const [ask, setAsk] = useState<QuestionKind | null>(null);
  const [askInput, setAskInput] = useState("");
  const [gathering, setGathering] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [publishing, setPublishing] = useState<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Restore after mount (not during render) so the server and the first client paint agree.
    const t = setTimeout(() => {
      try {
        const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as { model?: string; msgs?: Msg[] } | null;
        if (s?.msgs) setMsgs(s.msgs);
        if (s?.model) setModel(s.model);
      } catch {}
      restored.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    // Never save before the restore ran, or an empty first render wipes the saved conversation.
    if (!restored.current) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ model, msgs }));
    } catch {
      // Storage blocked or full (private mode, "block all cookies"): the chat still works, it just will not survive a reload.
    }
  }, [model, msgs]);
  useEffect(() => {
    // Block body on purpose: an implicit return would hand React whatever scrollIntoView returns as the "cleanup" (some engines
    // return a value), which then crashes the page with "is not a function" the next time the deps change.
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const note = snapshot?.wallet?.note ?? null;
  const stuck = useStuckRequest(!!snapshot?.wallet?.pending_request && !snapshot?.config?.active_lease);
  const ethUsd = price ? Number(price.answer) / 10 ** price.decimals : 0;
  const balanceUsd = note && ethUsd ? (Number(note.current_balance) / 1e9) * ethUsd : null;
  const lease = snapshot?.config?.active_lease ?? null;
  const picked = models?.find((m) => m.id === model);
  const shown = useMemo(() => (models ?? []).filter((m) => !filter || m.id.includes(filter.toLowerCase()) || (m.name ?? "").toLowerCase().includes(filter.toLowerCase())).slice(0, 60), [models, filter]);
  const canSend = !!client && !!note && !busy && input.trim().length > 0 && (balanceUsd === null || balanceUsd >= tier);

  const send = async (prepared?: Msg) => {
    if (!client || busy || !note) return;
    if (retryTimer.current) {
      clearInterval(retryTimer.current);
      retryTimer.current = null;
      setRetryIn(null);
    }
    const text = prepared?.content ?? input.trim();
    if (!text) return;
    if (!prepared) setInput("");
    setError(null);
    setBusy(true);
    let userMsg: Msg = prepared ?? { role: "user", content: text };
    // A question about zipcoin travels with the facts (origin, contract, links, live numbers), shown as a chip like on-chain data.
    if (!userMsg.context && mentionsZipcoin(text)) {
      const f = await zipcoinFacts();
      userMsg = { ...userMsg, context: f.context, summary: f.summary };
    }
    const history: Msg[] = [...msgs, userMsg];
    setMsgs([...history, { role: "assistant", content: "" }]);
    // What the model sees: the on-chain data rides along with the question that gathered it; the screen shows the summary.
    const wire = history.map((m) => ({ role: m.role, content: m.context ? `${m.content}\n\n[${m.summary?.startsWith("zipcoin facts") ? "Reference facts attached by chat.zipcoin.cash" : "On-chain data fetched by the user's browser from a public RPC, Sourcify and Blockscout"}]\n${m.context}` : m.content }));
    let access: Access | null = null;
    abort.current = new AbortController();
    try {
      setPhase("proving this chat is funded");
      access = await client.acquireInferenceAccess(SESSION, { spendingLimitUsd: tier, signal: abort.current.signal, onProgress: (p) => setPhase(p.message) });
      setPhase(null);
      // OpenRouter refuses a request whose worst case (max_tokens × output price) exceeds the key's remaining credit, and without
      // max_tokens it assumes the model's maximum. Size it from the $ cap and the model's price; cap at 8k, which is a long answer.
      const inPrice = Number(picked?.pricing?.prompt ?? 0);
      const outPrice = Number(picked?.pricing?.completion ?? 0);
      const promptTokens = Math.ceil(JSON.stringify(wire).length / 3.5);
      const budget = tier - promptTokens * inPrice - 0.02;
      if (outPrice > 0 && budget / outPrice < 256) throw new Error(`This conversation is too long for ${picked?.name ?? model} on a $${tier} key. Clear the chat or pick a cheaper model.`);
      let maxTokens = Math.min(8192, picked?.top_provider?.max_completion_tokens ?? 8192, outPrice > 0 ? Math.floor(budget / outPrice) : 8192);
      let r: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        r = await fetch(`${access.baseUrl}/chat/completions`, {
          method: "POST",
          headers: access.headers,
          signal: abort.current.signal,
          body: JSON.stringify({ model, messages: wire, stream: true, max_tokens: Math.max(256, maxTokens), stream_options: { include_usage: true } }),
        });
        if (r.status !== 402 || attempt === 1) break;
        // "You requested up to X tokens, but can only afford Y": take Y and go again.
        const afford = /can only afford (\d+)/.exec(await r.clone().text());
        if (!afford) break;
        maxTokens = Math.floor(Number(afford[1]) * 0.9);
      }
      if (!r) throw new Error("no response");
      if (r.status === 402) throw new Error(`${picked?.name ?? model} costs more than a $${tier} key can cover for this message. Shorten it, clear the chat, or pick a cheaper model.`);
      if (!r.ok || !r.body) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let out = "";
      let u: Usage | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: Usage; error?: { message?: string } };
            if (j.error) throw new Error(j.error.message ?? "provider error");
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) {
              out += delta;
              setMsgs([...history, { role: "assistant", content: out }]);
            }
            if (j.usage) u = j.usage;
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      if (u) {
        const est = picked?.pricing ? u.prompt_tokens * Number(picked.pricing.prompt) + u.completion_tokens * Number(picked.pricing.completion) : 0;
        setUsage((s) => ({ prompt: s.prompt + u!.prompt_tokens, completion: s.completion + u!.completion_tokens, cost: s.cost + (u!.cost ?? est), requests: s.requests + 1 }));
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message.split("\n")[0] : "failed";
      const quoteGap = /native_quote_expired|quote expired/i.test(raw);
      const m = /OA org key request returned 4\d\d/i.test(raw)
        ? "OA refused to issue the key for this request (their side, not your balance). The request is now parked on OA's server; nothing can be spent or withdrawn until they accept or clear it. We have reported it. Come back later and send again."
        : /Another browser tab owns the current private key/i.test(raw)
          ? `${raw.replace(/^Another browser tab owns/, "A previous tab of yours still holds")} It frees itself then (five minutes at most). Just send again after that.`
          : quoteGap
            ? "zkAPI's price feed is between updates (this happens for a few minutes every hour). Nothing is wrong with your credits; your message is sent again automatically."
            : raw;
      if (!/abort/i.test(m)) setError(m);
      setMsgs((cur) => (cur[cur.length - 1]?.role === "assistant" && !cur[cur.length - 1].content ? cur.slice(0, -1) : cur));
      if (quoteGap) scheduleRetry(prepared ?? { role: "user", content: text });
    } finally {
      access?.release();
      setPhase(null);
      setBusy(false);
    }
  };

  /** The conversation as a file: Markdown to read, JSON to re-import or feed to something else. Nothing but the words. */
  const exportChat = (kind: "md" | "json") => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const body =
      kind === "json"
        ? JSON.stringify({ exported: new Date().toISOString(), model, messages: msgs.map((m) => ({ role: m.role, content: m.content, ...(m.summary ? { onchain: m.summary } : {}) })) }, null, 2)
        : [`# chat.zipcoin.cash · ${picked?.name ?? model} · ${stamp}`, "", ...msgs.map((m) => (m.role === "user" ? `**You:** ${m.summary ? m.content.split("\n")[0] : m.content}${m.summary ? `\n\n_on-chain data attached · ${m.summary}_` : ""}` : m.content)).flatMap((x) => [x, "", "---", ""])].join("\n");
    const blob = new Blob([body], { type: kind === "json" ? "application/json" : "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zipcoin-chat-${new Date().toISOString().slice(0, 10)}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** zkAPI's quote comes from the Chainlink round at the finalized block and lives 75 minutes; around each hourly update it can be
   *  briefly expired for everyone. Take the message back and send it again in a minute, visibly, instead of asking the user to retype. */
  const scheduleRetry = (msg: Msg) => {
    if (retryTimer.current) clearInterval(retryTimer.current);
    let left = 60;
    setRetryIn(left);
    retryTimer.current = setInterval(() => {
      left -= 1;
      setRetryIn(left);
      if (left <= 0) {
        clearInterval(retryTimer.current!);
        retryTimer.current = null;
        setRetryIn(null);
        setMsgs((cur) => (cur[cur.length - 1]?.role === "user" ? cur.slice(0, -1) : cur));
        setTimeout(() => void send(msg), 50);
      }
    }, 1000);
  };

  /** Fetch the chain data in the browser, then ask with it attached. The address or hash is never sent to zipcoin's server. */
  const askOnChain = async () => {
    if (!ask || !askInput.trim()) return;
    setError(null);
    setGathering("reading the chain from your browser");
    try {
      const g: Gathered = await gather(ask, askInput);
      const label = { tx: "Explain this transaction", contract: "Check this contract", wallet: "Analyse this wallet" }[ask];
      setAsk(null);
      setAskInput("");
      setGathering(null);
      await send({ role: "user", content: `${label}: ${g.subject}\n\n${QUESTIONS[ask].prompt}`, context: g.context, summary: g.summary });
    } catch (e) {
      setGathering(null);
      setError(e instanceof Error ? e.message.split("\n")[0] : "could not read the chain");
    }
  };

  if (sdkError) return <Notice tone="burn">zkAPI SDK: {sdkError}</Notice>;
  if (snapshot && !note)
    return (
      <div className="space-y-4 page-in">
        <Notice>No credits in this browser yet. <Link href="/" className="underline">Fund a chat</Link> first, or <Link href="/wallet" className="underline">restore a backup</Link>.</Notice>
      </div>
    );

  return (
    <div className="grid gap-6 page-in md:grid-cols-[1fr_280px]">
      <Card className="flex min-h-[70vh] flex-col">
        <CardHead title={picked?.name ?? model} hint={lease ? `key live, cap $${lease.spending_limit_usd}, ${Math.max(0, lease.expires_at - Math.floor(Date.now() / 1000))}s` : "no key yet"} right={
            <span className="flex gap-3 text-xs">
              {msgs.length > 0 && <button className="text-muted hover:text-snow" onClick={() => exportChat("md")} title="download as Markdown">export</button>}
              {msgs.length > 0 && <button className="text-muted hover:text-snow" onClick={() => exportChat("json")} title="download as JSON">json</button>}
              <button className="text-muted hover:text-snow" onClick={() => { if (!msgs.length || confirm("Clear this conversation? Export it first if you want to keep it.")) { setMsgs([]); setUsage({ prompt: 0, completion: 0, cost: 0, requests: 0 }); } }}>clear</button>
            </span>
          } />
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {msgs.length === 0 && <p className="text-sm text-faint">Nothing here yet. The first message proves your balance and gets a short-lived key; later ones reuse it until it expires.</p>}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] border border-line bg-raised px-4 py-3 text-sm text-snow">
                <div className="whitespace-pre-wrap">{m.summary && !m.summary.startsWith("zipcoin facts") ? m.content.split("\n")[0] : m.content}</div>
                {m.summary && <div className="mt-2 text-xs text-tap">{m.summary.startsWith("zipcoin facts") ? m.summary : `on-chain data attached · ${m.summary}`}</div>}
              </div>
            ) : (
              <div key={i} className="max-w-[92%]">
                <div className="font-serif text-base leading-relaxed text-snow">
                  {m.content ? <Markdown text={m.content} /> : busy && i === msgs.length - 1 ? <span className="caret text-muted">{phase ?? "thinking"}</span> : ""}
                </div>
                {m.content && !(busy && i === msgs.length - 1) && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button className={publishing === i ? "text-tap" : "text-muted hover:text-snow"} onClick={() => setPublishing(publishing === i ? null : i)} title="Burn ZC to put this answer on Ethereum; @zipcoinbook posts it">Publish to the book</button>
                    <button className="text-muted hover:text-snow" onClick={() => navigator.clipboard.writeText(m.content)}>copy</button>
                  </div>
                )}
                {publishing === i && <PublishToBook answer={m.content} onClose={() => setPublishing(null)} />}
              </div>
            ),
          )}
          <div ref={bottom} />
        </div>
        <div className="border-t border-line p-4">
          {stuck && (
            <div className="mb-3">
              <Notice tone="burn">
                <span className="text-snow">Your chat is waiting on OA.</span> A key request for ${stuck.capUsd} made at {stuck.since} is parked on OA&apos;s server
                (status: {stuck.status}). Your balance is safe, but it cannot be spent or withdrawn until OA accepts or clears that request. We have reported
                it to them. Sending a message retries it; nothing else is needed from you.
              </Notice>
            </div>
          )}
          {error && <div className="mb-3"><Notice tone="burn">{error}{retryIn !== null && <span className="text-snow"> Retrying in {retryIn}s…</span>}</Notice></div>}
          {balanceUsd !== null && balanceUsd < tier && <div className="mb-3"><Notice tone="burn">Balance ${balanceUsd.toFixed(2)} is below the ${tier} needed for a key. Fund more.</Notice></div>}
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-faint">Ask about your bags without telling anyone they&apos;re yours:</span>
            {(Object.keys(QUESTIONS) as QuestionKind[]).map((k) => (
              <button key={k} type="button" onClick={() => { setAsk(ask === k ? null : k); setAskInput(""); }} className={`press border px-3 py-1 ${ask === k ? "border-tap text-tap" : "border-line text-muted hover:text-snow"}`} disabled={busy || !!gathering}>
                {QUESTIONS[k].label}
              </button>
            ))}
          </div>
          {ask && (
            <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); askOnChain(); }}>
              <input className={`${inputCls} flex-1 text-sm`} placeholder={QUESTIONS[ask].placeholder} value={askInput} onChange={(e) => setAskInput(e.target.value.trim())} spellCheck={false} autoFocus />
              <Button type="submit" disabled={!askInput || !!gathering || busy} busy={!!gathering}>Ask</Button>
            </form>
          )}
          {gathering && <p className="caret mb-3 text-xs text-muted">{gathering}</p>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea
              className={`${inputCls} h-20 flex-1 resize-none text-sm`}
              placeholder="Say something. It goes from this browser to the provider; this site never sees it."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            {busy ? <Button type="button" tone="ghost" onClick={() => abort.current?.abort()}>stop</Button> : <Button type="submit" disabled={!canSend}>send</Button>}
          </form>
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHead title="Credits" />
          <div className="space-y-2 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Balance</span><span>{note ? `${(Number(note.current_balance) / 1e9).toFixed(6)} ETH` : "…"}</span></div>
            <div className="flex justify-between"><span className="text-muted">≈ USD</span><span>{balanceUsd !== null ? `$${balanceUsd.toFixed(2)}` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted">Expires</span><span className="text-xs">{note ? new Date(note.expiry_ts * 1000).toLocaleDateString() : "…"}</span></div>
            <div className="flex justify-between"><span className="text-muted">Key</span><span className="text-xs">{lease ? `live, ${Math.max(0, lease.expires_at - Math.floor(Date.now() / 1000))}s left` : `$${tier} per 5 min, renews itself`}</span></div>
            <div className="flex justify-between"><span className="text-muted">This session</span><span className="text-xs">{usage.requests} req · {usage.prompt + usage.completion} tok · {usage.cost === 0 ? "$0" : usage.cost < 0.001 ? `$${usage.cost.toFixed(6)}` : `$${usage.cost.toFixed(4)}`}</span></div>
            <Link href="/wallet" className="block pt-2 text-xs text-muted underline hover:text-snow">back up or withdraw</Link>
          </div>
        </Card>
        <Card>
          <CardHead title="Model" hint={picked ? `${perM(picked.pricing?.prompt)} in · ${perM(picked.pricing?.completion)} out` : undefined} />
          <div className="p-4">
            <input className={`${inputCls} mb-2 text-xs`} placeholder="search OpenRouter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul className="max-h-64 overflow-y-auto border border-line text-xs">
              {shown.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setModel(m.id)} className={`block w-full truncate px-3 py-2 text-left ${m.id === model ? "bg-raised text-snow" : "text-muted hover:text-snow"}`} title={m.id}>{m.id}</button>
                </li>
              ))}
              {!models && <li className="caret px-3 py-2 text-faint">loading catalog</li>}
            </ul>
            <input className={`${inputCls} mt-2 text-xs`} value={model} onChange={(e) => setModel(e.target.value.trim())} spellCheck={false} />
          </div>
        </Card>
      </div>
    </div>
  );
}
