// Privacy Pools circuit artifacts (0xbow's published Groth16 keys + wasm), fetched once into public/artifacts so the repo stays small.
// They are the same files zipcoin.cash serves; proofs are built in the browser from them.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.ARTIFACTS_BASE ?? "https://www.zipcoin.cash/artifacts";
const FILES = ["commitment.vkey", "commitment.wasm", "commitment.zkey", "withdraw.vkey", "withdraw.wasm", "withdraw.zkey"];
const dir = join(process.cwd(), "public", "artifacts");
mkdirSync(dir, { recursive: true });
for (const f of FILES) {
  const p = join(dir, f);
  if (existsSync(p) && statSync(p).size > 0) continue;
  const r = await fetch(`${BASE}/${f}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(p, buf);
  console.log(`[artifacts] ${f} ${buf.length} bytes sha256 ${createHash("sha256").update(buf).digest("hex").slice(0, 16)}…`);
}
