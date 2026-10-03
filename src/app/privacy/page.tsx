import { Card, CardHead, PageHead } from "@/components/ui";
import { ADDR, OA_URL, ZIPCOIN_URL, ZKAPI_URL } from "@/lib/config";

export const metadata = { title: "zipcoin chat — what is private, what is not" };

export default function PrivacyPage() {
  return (
    <div className="space-y-8 page-in">
      <PageHead title="What is private here, and what is not.">Plain words. If something below is wrong, tell us and we fix the page or the code.</PageHead>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHead title="Who sees what" />
          <ul className="space-y-3 p-5 text-sm leading-relaxed text-muted">
            <li><span className="text-snow">The model provider (OpenRouter and the model behind it)</span> sees your prompt text, the answer, and your network address (IP). It does not learn who paid: the key it receives is a short-lived child key issued by Open Anonymity&apos;s org, tied to a proof, not to a person. Use Tor or a VPN if your IP matters.</li>
            <li><span className="text-snow">zkAPI&apos;s server</span> sees a zero-knowledge proof that some funded note can pay, a spending cap, and later how much the key used. It does not see prompts, and it cannot tell which deposit the note came from.</li>
            <li><span className="text-snow">This site (chat.zipcoin.cash)</span> serves the page and relays prompt-free protocol messages to zkAPI&apos;s server, because that server does not accept browsers from other origins. Those messages carry proofs, Merkle data and settlement; the issued key passes through once in a response. We never see prompts, answers, your note or your funding key, and we keep no accounts and no server-side logs of these relays.</li>
            <li><span className="text-snow">zipcoin.cash&apos;s relayer</span>, when you fund from a note, sees the proof and the destination address, pays the gas, and earns the relay fee. It cannot see which deposit the note came from.</li>
            <li><span className="text-snow">Ethereum</span> sees the funding address receive ETH (from a privacy pool or, if you chose plain ETH, from your wallet) and deposit into the vault. A plain-ETH funding links your wallet to that address forever; a note does not.</li>
          </ul>
        </Card>

        <Card>
          <CardHead title="What lives in this browser" />
          <ul className="space-y-3 p-5 text-sm leading-relaxed text-muted">
            <li>The throwaway funding key (IndexedDB, this origin).</li>
            <li>zkAPI&apos;s wallet: the note secret, signed balances, recovery journals (IndexedDB, their SDK&apos;s database).</li>
            <li>Your conversation and settings (localStorage), until you clear them.</li>
            <li>The 12-word zip phrase, only while this tab is open, only if you pasted one. A cheque link&apos;s <code>#phrase=</code> fragment is read by the page and removed from the address bar; browsers never send fragments to servers.</li>
            <li>Nothing here is synced anywhere. Clearing site data loses the credits; the backup on /wallet is the only copy you control.</li>
          </ul>
        </Card>
      </div>

      <Card>
        <div id="openrouter" className="scroll-mt-24">
          <CardHead title="How OpenRouter is used" hint="for the curious, and for OpenRouter's directory" />
        </div>
        <div className="space-y-3 p-5 text-sm leading-relaxed text-muted">
          <p>
            Every answer here comes from a model on <a className="text-ice hover:underline" href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a>; the catalog you pick from is theirs. The request goes from your browser straight to
            <code> openrouter.ai/api/v1/chat/completions</code>, streamed, with the usual <code>HTTP-Referer: https://chat.zipcoin.cash</code> and <code>X-Title: zipcoin chat</code> headers so OpenRouter knows which app it is.
          </p>
          <p>
            <span className="text-snow">There is no &ldquo;bring your own key&rdquo; mode, on purpose.</span> The key the browser uses is a short-lived child key (five minutes, $1 cap) minted by Open Anonymity&apos;s OpenRouter organisation
            after zkAPI&apos;s server checks a zero-knowledge proof that a funded note can pay. It is never tied to an account of yours; when it expires, the usage is settled against the note and the next message gets a new key. A personal
            OpenRouter key would put an account, a card and a billing history behind every prompt, which is the one thing this page exists to avoid.
          </p>
          <p>
            What OpenRouter can see: the prompt and the answer, your IP address, the model, the app name. What it cannot see: who paid, which wallet funded the note, or that two sessions belong to the same person.
            Prefer nothing to leave your machine at all? The chat also runs against a model on your own computer (Model → <em>on my computer</em>), with no OpenRouter involved.
          </p>
        </div>
      </Card>

      <Card>
        <CardHead title="Experimental, and whose it is" />
        <div className="space-y-3 p-5 text-sm leading-relaxed text-muted">
          <p>
            Private payments run on <a className="text-snow underline" href={ZKAPI_URL} target="_blank" rel="noreferrer">zkAPI</a>, a protocol by{" "}
            <a className="text-snow underline" href={OA_URL} target="_blank" rel="noreferrer">Open Anonymity</a> with the Ethereum Foundation&apos;s dAI team, from a design by Davide Crapis and Vitalik Buterin. The vault
            (<code>{ADDR.zkapiVault}</code>), the circuits, the server and the browser wallet SDK are theirs; this page runs their SDK at a pinned revision, unchanged, with our own funding address instead of a wallet extension.
            zipcoin has no partnership with them and no endorsement from them; this works with their public contract and SDK.
          </p>
          <p>
            Their own words: single-party trusted setup, unaudited integration, no deposit cap. Notes expire 30 days after the deposit and the balance then goes to their operator. The vault owner can pause deposits and closes.
            The deposit costs about 6.7 million gas. Keep amounts small.
          </p>
          <p>
            Funding runs on <a className="text-snow underline" href={ZIPCOIN_URL} target="_blank" rel="noreferrer">zipcoin</a>: Privacy Pools by 0xbow, zipcoin&apos;s ZC pool and ZipChanger. Those contracts are verified and
            unaudited. zipcoin&apos;s income here is the relay fee and the sales tax inside a ZC sale; nothing is taken from inference.
          </p>
        </div>
      </Card>
    </div>
  );
}
