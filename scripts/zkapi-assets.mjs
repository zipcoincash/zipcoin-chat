// Publishes the zkAPI browser SDK's public artifacts (WASM, proving keys, proof worker) under public/zkapi/ from the
// pinned package, then writes our reviewed browser-config for the chosen network over the SDK's bundled one.
// ZKAPI_NETWORK=mainnet (default) | fork. Nothing here is secret; hashes are verified by the SDK helper and again in the worker.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { buildBrowserSdkAssets } from "@openanonymity/zkapi-browser-sdk/build";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const network = process.env.ZKAPI_NETWORK ?? "mainnet";
if (!["mainnet", "fork"].includes(network)) throw new Error("ZKAPI_NETWORK must be mainnet or fork");
const outDir = path.join(root, "public", "zkapi");

const result = await buildBrowserSdkAssets({ outDir, publicPath: "/zkapi/", network: "mainnet", build });
const ours = JSON.parse(await fs.readFile(path.join(root, "config", `zkapi.${network}.json`), "utf8"));
const theirs = result.config;
// Guard: our pins must equal the SDK's for everything except the fields we knowingly set (verifier, fork endpoints).
const allowed = new Set(["trusted_deployment.verifier_url", "trusted_deployment.rpc_url", "trusted_deployment.protocol_server_url", "trusted_deployment.indexer_url", "deployment_manifest_url", "allowed_deployment_manifest_urls", "deployment_api_proxy_path"]);
const flat = (o, p = "") => Object.entries(o).reduce((acc, [k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? Object.assign(acc, flat(v, `${p}${k}.`)) : Object.assign(acc, { [`${p}${k}`]: JSON.stringify(v) })), {});
const a = flat(theirs), b = flat(ours);
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (a[k] !== b[k] && !allowed.has(k)) throw new Error(`browser-config pin drift at ${k}: sdk=${a[k]} ours=${b[k]}`);
}
await fs.writeFile(path.join(outDir, "browser-config.json"), `${JSON.stringify(ours, null, 2)}\n`);
console.log(`[zkapi-assets] ${network}: ${Object.keys(result.files).length} files -> public/zkapi (verifier ${ours.trusted_deployment.verifier_url})`);
