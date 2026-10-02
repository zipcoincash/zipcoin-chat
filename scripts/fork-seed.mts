/**
 * Seeds an anvil mainnet fork with notes a test zip key can spend from the chat: a ZC note in zipcoin's pool (approved by
 * the local web server's postman loop) and an ETH note in 0xbow's pool (approved by impersonating their postman; the local
 * web server reads the matching ASP leaves from BOW_ASP_FILE). Prints the phrase. Fork only.
 * env: RPC (anvil), API (local zipcoin web server), BOW_ASP_FILE (same path the web server was started with), PHRASE (optional)
 */
import { randomBytes as rnd } from "node:crypto";
import fs from "node:fs";

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { createPublicClient, createTestClient, createWalletClient, decodeEventLog, encodeFunctionData, formatEther, http, parseAbi, parseEther, parseGwei, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import { ADDR } from "../src/lib/config";
import { POOLS } from "../src/lib/pools";
import { buildTree, hashPrecommitment, type PoolStateJson } from "../src/lib/tree";
import { depositSecrets, masterKeys } from "../src/lib/zip";

const RPC = process.env.RPC ?? "http://127.0.0.1:8547";
const API = process.env.API ?? "http://localhost:3101";
const chain = { ...mainnet, id: 1 };
const transport = http(RPC);
const pub = createPublicClient({ chain, transport });
const test = createTestClient({ chain, mode: "anvil", transport });
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const wallet = createWalletClient({ account, chain, transport });

const entrypointAbi = parseAbi([
  "function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)",
  "function deposit(uint256 _precommitment) payable returns (uint256)",
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256)",
]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const routerAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function buyWethPairWithEth(PoolKey key, uint256 minOut, bytes hookData) payable returns (uint256 amountOut)",
]);
const depEv = parseAbi(["event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)"]);
const ROUTER = "0xcdf832D2C11DA16055bb6C6145cF38EDD7233767" as Address;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const HOOK = "0x322dcEc4958C14e021A9F1cD49DF11b9457968cC" as Address;
const BOW_POSTMAN = "0x1f4fe25cf802a0605229e0dc497aaf653e86e187" as Address;
const zcFirst = BigInt(ADDR.zc) < BigInt(WETH);
const poolKey = { currency0: zcFirst ? ADDR.zc : WETH, currency1: zcFirst ? WETH : ADDR.zc, fee: 0, tickSpacing: 200, hooks: HOOK } as const;

/** anvil's fee suggestions are odd on a fork (1 gwei tip over a 7 wei base); fix them. */
const FEES = { maxFeePerGas: parseGwei("2"), maxPriorityFeePerGas: parseGwei("0.1") };
const phrase = process.env.PHRASE ?? entropyToMnemonic(rnd(16), wordlist);
const keys = masterKeys(phrase);
const send = async (label: string, to: Address, data: `0x${string}`, value = 0n) => {
  const hash = await wallet.sendTransaction({ to, data, value, ...FEES });
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(r.status === "success" ? "ok  " : "FAIL", `${label} (gas ${r.gasUsed})`);
  if (r.status !== "success") process.exit(1);
  return r;
};
/** The first deposit index of this phrase that has no deposit yet in the pool (so re-seeding adds a note instead of reverting). */
async function nextIndex(pool: "zc" | "eth") {
  const st = (await (await fetch(`${API}/api/state?pool=${pool}`, { cache: "no-store" })).json()) as PoolStateJson;
  const used = new Set(st.deposits.map((d) => d.precommitment));
  for (let i = 0n; ; i++) {
    const { nullifier, secret } = depositSecrets(keys, POOLS[pool].scope, i);
    if (!used.has(hashPrecommitment(nullifier, secret).toString())) return i;
  }
}
const labelOf = (r: Awaited<ReturnType<typeof send>>, pre: bigint) => {
  const ev = r.logs.map((l) => { try { return decodeEventLog({ abi: depEv, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e && e.args._precommitmentHash === pre)!;
  return ev.args._label;
};

// 1. ZC note: buy, approve, deposit with the phrase's deposit #0 secrets. The web postman approves it within seconds.
{
  const { nullifier, secret } = depositSecrets(keys, POOLS.zc.scope, await nextIndex("zc"));
  const pre = hashPrecommitment(nullifier, secret);
  const want = parseEther(process.env.ZC_AMOUNT ?? "6000");
  const { result: perProbe } = await pub.simulateContract({ account, address: ROUTER, abi: routerAbi, functionName: "buyWethPairWithEth", args: [poolKey, 0n, "0x"], value: parseEther("0.01") });
  const ethIn = ((want + parseEther("200")) * parseEther("0.01") * 10_300n) / (perProbe * 10_000n);
  await send(`buy ZC with ${formatEther(ethIn)} ETH`, ROUTER, encodeFunctionData({ abi: routerAbi, functionName: "buyWethPairWithEth", args: [poolKey, want, "0x"] }), ethIn);
  await send("approve ZC", ADDR.zc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ADDR.entrypoint, want] }));
  const r = await send(`deposit ${formatEther(want)} ZC`, ADDR.entrypoint, encodeFunctionData({ abi: entrypointAbi, functionName: "deposit", args: [ADDR.zc, want, pre] }));
  console.log(`     ZC note label ${labelOf(r, pre)}`);
}

// 2. ETH note in 0xbow's pool, approved on the fork as their postman; the local web server needs the ASP leaves in a file.
{
  const { nullifier, secret } = depositSecrets(keys, POOLS.eth.scope, await nextIndex("eth"));
  const pre = hashPrecommitment(nullifier, secret);
  const value = parseEther(process.env.ETH_AMOUNT ?? "0.05");
  let state: PoolStateJson | null = null;
  for (let i = 0; i < 90 && !state; i++) {
    const s = (await (await fetch(`${API}/api/state?pool=eth`, { cache: "no-store" })).json()) as PoolStateJson;
    if (s.aspLeaves.length > 0 && s.deposits.length > 5000) state = s;
    else {
      if (i % 6 === 0) console.log(`     waiting for the local server to index 0xbow's pool (${s.deposits.length} deposits so far)`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  if (!state) throw new Error("0xbow pool not indexed");
  const r = await send(`deposit ${formatEther(value)} ETH into 0xbow's pool`, POOLS.eth.entrypoint, encodeFunctionData({ abi: entrypointAbi, functionName: "deposit", args: [pre] }), value);
  const label = labelOf(r, pre);
  const leaves = [...state.aspLeaves.map(BigInt), label];
  const root = buildTree(leaves).root;
  const aspFile = process.env.BOW_ASP_FILE ?? "/tmp/bow-asp-chat.json";
  fs.writeFileSync(aspFile, JSON.stringify(leaves.map(String)));
  await test.impersonateAccount({ address: BOW_POSTMAN });
  await test.setBalance({ address: BOW_POSTMAN, value: parseEther("1") });
  const hash = await createWalletClient({ account: BOW_POSTMAN, chain, transport }).sendTransaction({ ...FEES, to: POOLS.eth.entrypoint, data: encodeFunctionData({ abi: entrypointAbi, functionName: "updateRoot", args: [root, "bafybeifehz3v5g2gep5dm35w76sxfai7uq2rgvchpaers3cp3o652prpma"] }) });
  const up = await pub.waitForTransactionReceipt({ hash });
  console.log(up.status === "success" ? "ok  " : "FAIL", `0xbow ASP root updated with our label (leaves -> ${aspFile})`);
  await test.stopImpersonatingAccount({ address: BOW_POSTMAN });
}

console.log(`\nPHRASE=${phrase}`);
