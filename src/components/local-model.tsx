"use client";

import { useEffect, useState } from "react";

import { Button, Info, inputCls, Notice } from "./ui";

export const LOCAL_PREFIX = "local:";
export const LOCAL_STORE = "zc-local-endpoint";
export const DEFAULT_LOCAL = "http://localhost:11434/v1";
export const localModelId = (model: string) => (model.startsWith(LOCAL_PREFIX) ? model.slice(LOCAL_PREFIX.length) : null);
export const readLocalEndpoint = () => {
  try {
    return localStorage.getItem(LOCAL_STORE) || DEFAULT_LOCAL;
  } catch {
    return DEFAULT_LOCAL;
  }
};

/**
 * A model on your own machine, through any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM). No credits, no key, no
 * provider: the browser talks to localhost. The endpoint is remembered in this browser only.
 */
export function LocalModelPicker({ model, onPick }: { model: string; onPick: (id: string) => void }) {
  const [endpoint, setEndpoint] = useState(DEFAULT_LOCAL);
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEndpoint(readLocalEndpoint()), 0);
    return () => clearTimeout(t);
  }, []);

  const probe = async () => {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const base = endpoint.replace(/\/+$/, "");
      const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`${r.status} from ${base}/models`);
      const j = (await r.json()) as { data?: { id: string }[] };
      const ids = (j.data ?? []).map((m) => m.id);
      if (!ids.length) throw new Error("the endpoint answered but lists no models (pull one first, e.g. `ollama pull llama3.2`)");
      localStorage.setItem(LOCAL_STORE, base);
      setFound(ids);
      if (!localModelId(model) || !ids.includes(localModelId(model)!)) onPick(LOCAL_PREFIX + ids[0]);
    } catch (e) {
      const m = e instanceof Error ? e.message : "failed";
      setError(/Failed to fetch|NetworkError|Load failed/i.test(m) ? "Could not reach it from this page. Is it running, and does it allow this origin? Ollama: start it with OLLAMA_ORIGINS=https://chat.zipcoin.cash (or \"*\"). LM Studio: enable CORS in the server settings." : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-faint">
        Runs on your computer. Nothing leaves it, nothing is paid.
        <Info label="How does this work?">
          Any OpenAI-compatible server works: Ollama (default port 11434), LM Studio, llama.cpp, vLLM. The page calls it directly from your
          browser, so the server must allow this origin (CORS). The chat does not need zkAPI credits in this mode; the model, the prompt and
          the answer never leave your machine. Phones cannot run this; a laptop with 8–16 GB of RAM handles 7–8B models.
        </Info>
      </p>
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1 text-xs`} value={endpoint} onChange={(e) => setEndpoint(e.target.value.trim())} spellCheck={false} placeholder={DEFAULT_LOCAL} />
        <Button tone="ghost" onClick={probe} busy={busy} disabled={!endpoint}>
          Connect
        </Button>
      </div>
      {error && <Notice tone="burn">{error}</Notice>}
      {found && (
        <ul className="max-h-48 overflow-y-auto border border-line text-xs">
          {found.map((id) => (
            <li key={id}>
              <button onClick={() => onPick(LOCAL_PREFIX + id)} className={`block w-full truncate px-3 py-2 text-left ${model === LOCAL_PREFIX + id ? "bg-raised text-snow" : "text-muted hover:text-snow"}`} title={id}>
                {id}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!found && !error && <p className="text-xs text-faint">Ollama one-liner: <code className="text-muted">OLLAMA_ORIGINS=https://chat.zipcoin.cash ollama serve</code>, then Connect.</p>}
    </div>
  );
}
