"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { formatUnits } from "viem";

import { EXPLORER } from "@/lib/config";

export const fmtZc = (v: bigint | string, digits = 0) =>
  Number(formatUnits(BigInt(v), 18)).toLocaleString("en-US", { maximumFractionDigits: digits });

export const fmtEth = (v: bigint | string) =>
  Number(formatUnits(BigInt(v), 18)).toLocaleString("en-US", { maximumFractionDigits: 4 });

export const fmtUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-line bg-surface ${className}`}>{children}</section>;
}

export function CardHead({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 className="shrink-0 text-sm text-snow">{title}</h2>
        {hint && <span className="truncate text-xs text-faint">{hint}</span>}
      </div>
      {right}
    </div>
  );
}

/** Page title and the one sentence that says what the page does. Product text, so mono. */
export function PageHead({ title, children, right }: { title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-3xl leading-[1.02] tracking-[-0.03em] text-snow md:text-5xl">{title}</h1>
        {children && <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>}
      </div>
      {right}
    </div>
  );
}

/** A line from the book: Newsreader, with the chapter it comes from. Never mixed with a claim of ours. */
export function Quote({ children, ch, size = "md" }: { children: ReactNode; ch: string; size?: "sm" | "md" | "lg" }) {
  const cls = { sm: "text-lg", md: "text-2xl md:text-3xl", lg: "text-3xl md:text-5xl" }[size];
  return (
    <figure>
      <blockquote className={`font-serif leading-[1.15] text-snow ${cls}`}>&ldquo;{children}&rdquo;</blockquote>
      <figcaption className="mt-3 text-xs text-faint">Snowmoon, {ch}</figcaption>
    </figure>
  );
}

const pillTones = {
  burn: "bg-burn text-night hover:opacity-90",
  tap: "bg-tap text-night hover:opacity-90",
  ghost: "border border-line text-snow hover:border-muted",
};

/** A link that takes you somewhere. Buttons act, pills navigate. */
export function Pill({ href, children, tone = "ghost", external }: { href: string; children: ReactNode; tone?: keyof typeof pillTones; external?: boolean }) {
  const cls = `press inline-flex h-11 items-center rounded-full px-5 text-sm font-medium ${pillTones[tone]}`;
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** One number with its label: the stat block used on /analytics, /books and the door pages. */
export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface p-5">
      <div className="text-xs text-faint">{label}</div>
      <div className="mt-2 break-words text-lg text-snow">{value}</div>
      {sub && <div className="mt-1 text-xs leading-relaxed text-muted">{sub}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/** Nothing here yet: say so plainly, and offer the one thing to do about it. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-sm leading-relaxed text-faint">
      <p className="max-w-md">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Waiting on the chain: a caret and the shape of what is coming, no spinner. */
export function Loading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-3 py-2" role="status" aria-live="polite">
      <div className="caret text-sm text-muted">{label}</div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-3 bg-line" style={{ width: `${88 - i * 17}%` }} />
      ))}
    </div>
  );
}

export function Button({
  children,
  tone = "tap",
  busy,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "tap" | "burn" | "ghost"; busy?: boolean }) {
  const tones = {
    tap: "bg-tap text-night hover:opacity-90 disabled:bg-line disabled:text-faint disabled:opacity-100",
    burn: "bg-burn text-night hover:opacity-90 disabled:bg-line disabled:text-faint disabled:opacity-100",
    ghost: "border border-line text-snow hover:border-muted disabled:text-faint",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`press h-11 px-5 text-sm font-medium disabled:cursor-not-allowed disabled:active:scale-100 ${tones[tone]} ${className}`}
    >
      {busy ? <span className="caret">working</span> : children}
    </button>
  );
}

/** A receipt in the style of the book's payment terminal tables. One grid, so the value column lines up on every row. */
export function Receipt({
  title,
  rows,
  tone = "tap",
  caption,
  size = "md",
}: {
  title: ReactNode;
  rows: [ReactNode, ReactNode][];
  tone?: "tap" | "burn" | "muted";
  caption?: ReactNode;
  size?: "md" | "lg";
}) {
  const color = { tap: "text-tap", burn: "text-burn", muted: "text-muted" }[tone];
  const cell = size === "lg" ? "py-3 md:py-4" : "py-2";
  return (
    <div className={size === "lg" ? "text-base md:text-lg" : "text-sm"}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-y border-line">
        <div className={`col-span-2 px-1 ${cell} ${color}`}>{title}</div>
        {rows.map(([k, v], i) => (
          <div key={i} className="contents">
            <div className={`min-w-0 border-t border-line px-1 text-muted ${cell}`}>{k}</div>
            <div className={`border-l border-t border-line px-3 text-right text-snow ${cell}`}>{v}</div>
          </div>
        ))}
      </div>
      {caption && <div className="px-1 pt-2 text-xs text-faint">{caption}</div>}
    </div>
  );
}

export function Addr({ a, label }: { a: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      {label && <span className="text-faint">{label}</span>}
      {EXPLORER ? (
        <a className="text-ice hover:underline" href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer" title={a}>
          {short(a)}
        </a>
      ) : (
        <span className="text-ice" title={a}>{short(a)}</span>
      )}
      <button
        className="text-xs text-faint hover:text-snow"
        onClick={() => {
          navigator.clipboard.writeText(a);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return EXPLORER ? (
    <a className="text-ice hover:underline" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
      {short(hash)}
    </a>
  ) : (
    <span className="text-ice">{short(hash)}</span>
  );
}

export function Field({ label, hint, info, children }: { label: string; hint?: ReactNode; info?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-muted">
        <span className="flex shrink-0 items-center gap-1.5">
          {label}
          {info && <Info>{info}</Info>}
        </span>
        {hint && <span className="min-w-0 truncate text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/**
 * The small ⓘ: one plain paragraph on hover, focus or tap. The label stays short; the explanation is here for whoever wants it.
 * Click toggles it (phones), Escape or clicking elsewhere closes it.
 */
export function Info({ children, label = "What is this?" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] leading-none text-faint hover:border-muted hover:text-snow focus:border-tap focus:text-snow focus:outline-none"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`absolute left-0 top-6 z-30 w-72 max-w-[80vw] border border-line bg-night p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-muted shadow-lg ${open ? "block" : "hidden group-hover:block group-focus-within:block"}`}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * Money, the way a person reads it: what it costs in total, what part of that is fees, and the breakdown only if they ask.
 * Rows are the same tuples a Receipt takes.
 */
export function FeeSummary({
  total,
  fees,
  rows,
  caption,
  totalLabel = "Total",
  feesLabel = "Fees",
  tone = "muted",
}: {
  total: ReactNode;
  fees: ReactNode;
  rows: [ReactNode, ReactNode][];
  caption?: ReactNode;
  totalLabel?: ReactNode;
  feesLabel?: ReactNode;
  tone?: "tap" | "burn" | "muted";
}) {
  const [open, setOpen] = useState(false);
  const color = { tap: "text-tap", burn: "text-burn", muted: "text-muted" }[tone];
  return (
    <div className="text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-y border-line">
        <div className="px-1 py-2 text-muted">{totalLabel}</div>
        <div className="border-l border-line px-3 py-2 text-right text-snow">{total}</div>
        <div className={`border-t border-line px-1 py-2 ${color}`}>{feesLabel}</div>
        <div className="border-l border-t border-line px-3 py-2 text-right text-snow">{fees}</div>
        {open &&
          rows.map(([k, v], i) => (
            <div key={i} className="contents">
              <div className="min-w-0 border-t border-line px-1 py-2 text-xs text-faint">{k}</div>
              <div className="border-l border-t border-line px-3 py-2 text-right text-xs text-muted">{v}</div>
            </div>
          ))}
      </div>
      <div className="flex items-baseline justify-between gap-3 px-1 pt-2 text-xs">
        <span className="text-faint">{caption}</span>
        {rows.length > 0 && (
          <button type="button" className="shrink-0 text-muted hover:text-snow" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide details ↑" : "View details ↓"}
          </button>
        )}
      </div>
    </div>
  );
}



export const inputCls =
  "w-full border border-line bg-night px-3 py-3 text-snow outline-none placeholder:text-faint focus:border-tap";

export function Notice({ tone = "muted", children }: { tone?: "muted" | "burn" | "tap"; children: ReactNode }) {
  const c = { muted: "border-line text-muted", burn: "border-burn/50 text-burn", tap: "border-tap/50 text-tap" }[tone];
  return <div className={`border px-4 py-3 text-xs leading-relaxed ${c}`}>{children}</div>;
}
