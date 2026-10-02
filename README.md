# chat.zipcoin.cash

**Private AI chat, paid with a zipped note.** No account. No wallet connection. Nothing to log in to.

Live: https://chat.zipcoin.cash · Part of [zipcoin](https://github.com/zipcoincash/zipcoin) · Works with [zkAPI](https://github.com/ethereum/zkapi)
(the private-payment protocol, vault, circuits and browser wallet are Open Anonymity's, built with the Ethereum Foundation's dAI team;
this app runs their SDK unchanged). Experimental: 30-day credit expiry, pausable vault, single-party trusted setup, unaudited. Their
words and ours. Keep it small.

## What it does

1. **Fund.** The page makes a throwaway key that lives only in your browser. Money reaches it from a zipped note (ZC through
   ZipChanger, ETH through 0xbow's Privacy Pool relay; zipcoin's relayer pays the gas), from a pasted zip phrase or a gift link
   (`#phrase=…`, never sent to any server), or as plain ETH (warned: that links the sender).
2. **Deposit.** The throwaway signs one transaction into zkAPI's vault. Your credits are a note held by zkAPI's browser wallet,
   in your browser.
3. **Chat.** Each message proves the note is funded, gets a short-lived capped key, and streams straight from the model provider.
   Our server never sees prompts or answers. Markdown answers, any model in the catalog, usage per session.
4. **Ask about your bags without telling anyone they're yours.** *Explain a tx · Check a contract · Analyse a wallet*: the browser
   fetches the on-chain data itself (public RPC, Sourcify, Blockscout) and sends it with the question.
5. **Publish to the book.** Burn ZC under any answer to put it on Ethereum, anonymously from a zipped note or publicly from a
   wallet. [@zipcoinbook](https://x.com/zipcoinbook) posts it.
6. **Gift links.** `/gift` makes links that fund a chat in one click for whoever opens them.
7. **Wallet.** Encrypted backup of key + credits; cooperative close or unilateral escape to any address.

What the server does: serve the page, and pass **prompt-free** protocol traffic to zkAPI's server (`/zkapi-deployment/*`, because
their `/v2` and `/v1/tree` send no CORS headers). No keys, no database, no logs of anything you type.

## Run

```bash
pnpm install
pnpm build      # fetches 0xbow's circuit artifacts + the pinned zkAPI SDK assets, then next build
pnpm start
# or: pnpm dev
```

Env (see `.env.example`): `NEXT_PUBLIC_ZIPCOIN_API` (zipcoin's API; its `/api/state|relay|pay-quote|stats` must allow this
origin), `NEXT_PUBLIC_RPC_URL` (chain reads and the throwaway's broadcasts), `NEXT_PUBLIC_SITE_URL`, `ZKAPI_SERVER` (proxy
target), `ZKAPI_NETWORK` (`mainnet` | `fork`), optional `NEXT_PUBLIC_KEY_CAP_USD` (per-key cap; OA's org issues $1 keys today).

`config/zkapi.mainnet.json` is zkAPI's mainnet config with the verifier the live deployment names; `scripts/zkapi-assets.mjs`
refuses any other drift between the SDK, this file and the live manifest.

## Fork rehearsal

`scripts/fork-up.sh` brings up anvil (mainnet fork), a stand-in for zkAPI's manifest + indexer (`scripts/fork-zkapi.mjs`, real
vault state, leaves recomputed with the deployed Poseidon library), seeds ZC and ETH notes (`scripts/fork-seed.mts`), and runs
this app against it. Deposits, backups, escapes, gift funding and publishing all run for real on the fork; leases need OA's live
server.

## Known limits

- One note per browser (zkAPI's wallet). Spend or withdraw before funding again.
- Clearing site data loses the credits unless you exported a backup.
- A vault deposit reverts if any other vault transaction lands between path computation and inclusion; the page recovers it
  (Resume), the gas of the reverted attempt is lost.
- zkAPI's price quote is briefly expired for everyone around each hourly Chainlink update; the page resends by itself.
- Upstream issues we track: [ethereum/zkapi#9](https://github.com/ethereum/zkapi/issues/9), [#15](https://github.com/ethereum/zkapi/issues/15).

MIT. Not affiliated with, endorsed by or a partner of the Ethereum Foundation, Open Anonymity or 0xbow.
