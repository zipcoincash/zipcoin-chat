"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Model output as readable text: headings, lists, tables, code with a copy button. No raw HTML is rendered, links open in a new tab. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4 hover:text-tap">{children}</a>,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children }) => (className ? <code className={className}>{children}</code> : <code className="rounded-sm bg-raised px-1 py-0.5 font-mono text-[0.85em] text-tap">{children}</code>),
          table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
          th: ({ children }) => <th className="border border-line bg-raised px-2 py-1 text-left font-mono text-xs font-normal text-muted">{children}</th>,
          td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const raw = extractText(children);
  return (
    <div className="group relative my-3">
      <pre className="overflow-x-auto border border-line bg-night p-3 font-mono text-xs leading-relaxed text-snow">{children}</pre>
      <button
        type="button"
        onClick={() => { navigator.clipboard.writeText(raw); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="absolute right-2 top-2 border border-line bg-raised px-2 py-0.5 text-[10px] text-muted opacity-0 transition-opacity hover:text-snow group-hover:opacity-100"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) return extractText((node as { props: { children?: ReactNode } }).props.children);
  return "";
}
