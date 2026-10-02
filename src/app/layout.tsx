import type { Metadata } from "next";
import type React from "react";
import { JetBrains_Mono, Newsreader } from "next/font/google";

import { Header } from "@/components/header";
import { OA_URL, SITE_URL, ZIPCOIN_URL, ZKAPI_URL } from "@/lib/config";

import "./globals.css";
import { Providers } from "./providers";

const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const serif = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "zipcoin chat — private AI, paid with a zipped note",
  description: "Chat with frontier models and pay from a zipped note. No account, no wallet link. Works with zkAPI (experimental).",
  openGraph: { type: "website", siteName: "zipcoin chat", url: SITE_URL },
  twitter: { card: "summary", site: "@zipcoincash" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable} h-full antialiased`}>
      <body className="grain flex min-h-full flex-col">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-5 md:py-10">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-xs leading-relaxed text-faint md:flex-row md:justify-between">
              <p className="max-w-2xl">
                Works with{" "}
                <a className="text-muted hover:text-snow" href={ZKAPI_URL} target="_blank" rel="noreferrer">
                  zkAPI
                </a>
                , built by{" "}
                <a className="text-muted hover:text-snow" href={OA_URL} target="_blank" rel="noreferrer">
                  Open Anonymity
                </a>{" "}
                with the Ethereum Foundation&apos;s dAI team: the private-payment protocol, vault, circuits and browser wallet are
                theirs, and this page runs their SDK unchanged. Funding comes from{" "}
                <a className="text-muted hover:text-snow" href={ZIPCOIN_URL} target="_blank" rel="noreferrer">
                  zipcoin
                </a>{" "}
                notes (Privacy Pools by 0xbow). Experimental, unaudited, no partnership or endorsement implied.
              </p>
              <p className="flex gap-4">
                <a className="text-muted hover:text-snow" href="https://x.com/zipcoincash" target="_blank" rel="noreferrer">
                  @zipcoincash
                </a>
                <a className="text-muted hover:text-snow" href="https://github.com/zipcoincash" target="_blank" rel="noreferrer">
                  github
                </a>
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
