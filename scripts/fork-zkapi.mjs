// Fork test helper: a stand-in for zkAPI's manifest + indexer against an anvil mainnet fork of the REAL vault.
// Serves /config.json (live manifest with fork endpoints), /health, /v1/tree/root, /v1/tree/snapshot. The snapshot starts from
// the live indexer's leaves (checked against the fork's currentRoot) and appends every note deposited on the fork, each leaf
// recomputed with the deployed Poseidon library (hash5("zkapi.v2.leaf", id, commitment, amount, expiry)) via eth_call.
// Never run against anything but a local fork. env: RPC (default http://127.0.0.1:8547), PORT (3250)
import http from "node:http";

const RPC = process.env.RPC ?? "http://127.0.0.1:8547";
const PORT = Number(process.env.PORT ?? 3250);
const LIVE = "https://zkapi-mainnet.openanonymity.ai";
const VAULT = "0x4386FDbdA35D995beB3BF8625118Ec5982ec81fe";
const POSEIDON = "0xc6B55e86668d8c446B3D81273AAb9CBb20F28c7f";
const DOMAIN_LEAF = 0x7a6b6170692e76322e6c656166n;
const sel = { currentRoot: "0xfdab463d", nextNoteId: "0x7a2043a3", notes: "0x9f18e4ed", hash5: "0xc98aeff5" };

const word = (v) => BigInt(v).toString(16).padStart(64, "0");
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const hex32 = (v) => `0x${BigInt(v).toString(16)}`;

// keccak("hash5(uint256,uint256,uint256,uint256,uint256)")[:4] — verify against the library once at boot.
async function leafFor(noteId) {
  const raw = await call(VAULT, `${sel.notes}${word(noteId)}`);
  const [commitment, amount, expiry] = raw.slice(2).match(/.{64}/g).slice(0, 3).map((w) => BigInt(`0x${w}`));
  const status = BigInt(`0x${raw.slice(2).match(/.{64}/g)[3]}`);
  if (status !== 1n) return 0n; // not Active (closed/expired): the vault zeroes that leaf
  const out = await call(POSEIDON, `${sel.hash5}${word(DOMAIN_LEAF)}${word(noteId)}${word(commitment)}${word(amount)}${word(expiry)}`);
  return BigInt(out);
}

const manifest = await (await fetch(`${LIVE}/config.json`)).json();
const base = await (await fetch(`${LIVE}/v1/tree/snapshot`)).json();
const forkRoot = BigInt(await call(VAULT, sel.currentRoot));
const forkNext = Number(BigInt(await call(VAULT, sel.nextNoteId)));
if (BigInt(base.root) !== forkRoot || base.next_note_id !== forkNext) {
  console.error(`live snapshot (root ${base.root.slice(0, 12)}…, next ${base.next_note_id}) != fork (root ${hex32(forkRoot).slice(0, 12)}…, next ${forkNext}); mainnet moved since the fork. Restart anvil from a fresh block.`);
  process.exit(1);
}
// Sanity: our leaf recomputation matches the indexer for the last live note.
if (forkNext > 0) {
  const check = await leafFor(forkNext - 1);
  if (hex32(check) !== hex32(BigInt(base.leaves[forkNext - 1]))) {
    console.error("leaf recomputation does not match the live indexer; hash5 selector or layout wrong");
    process.exit(1);
  }
}
const self = `http://127.0.0.1:${PORT}`;
const forkManifest = { ...manifest, rpc_url: RPC, protocol_server_url: self, indexer_url: self, config_url: `${self}/config.json` };
console.log(`[fork-zkapi] live root matches fork at note ${forkNext}; serving on ${self}`);
// Interval mining of empty blocks decays anvil's base fee to a few wei while its suggested tip stays 1 gwei; viem then refuses
// "tip above fee cap" on every estimate. Keep the next block's base fee at 1.5 gwei (above anvil's fixed 1 gwei tip suggestion).
setInterval(() => rpc("anvil_setNextBlockBaseFeePerGas", ["0x59682f00"]).catch(() => {}), 1000);

async function snapshot() {
  const next = Number(BigInt(await call(VAULT, sel.nextNoteId)));
  const leaves = base.leaves.slice(0, Math.min(next, base.next_note_id));
  for (let i = leaves.length; i < next; i++) leaves.push(hex32(await leafFor(i)));
  return { root: hex32(BigInt(await call(VAULT, sel.currentRoot))), next_note_id: next, leaves };
}

http
  .createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "cache-control": "no-store" };
    if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
    const url = new URL(req.url, self);
    try {
      let body;
      if (url.pathname === "/config.json") body = forkManifest;
      else if (url.pathname === "/health") body = { ...(await (await fetch(`${LIVE}/health`)).json()), fork: true };
      else if (url.pathname === "/v1/tree/root") body = { root: hex32(BigInt(await call(VAULT, sel.currentRoot))) };
      else if (url.pathname === "/v1/tree/snapshot") body = await snapshot();
      else if (url.pathname === "/v2/billing/quote") body = await (await fetch(`${LIVE}/v2/billing/quote`)).json();
      else return void res.writeHead(404, cors).end(JSON.stringify({ error: "fork stand-in: not implemented" }));
      res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify(body));
    } catch (e) {
      res.writeHead(500, cors).end(JSON.stringify({ error: String(e.message ?? e) }));
    }
  })
  .listen(PORT);
