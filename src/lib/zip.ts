import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { poseidon1, poseidon3 } from "poseidon-lite";
import { bytesToBigInt, hexToBytes, keccak256, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { hashCommitment, hashNullifier, hashPrecommitment, proveLeaf, SNARK_SCALAR_FIELD, type PoolStateJson } from "./tree";
import type { ProofJson, WithdrawalJson } from "./codec";
import { encodeAbiParameters } from "viem";

export const ZIP_MESSAGE =
  "zipcoin: unlock my zip key (v1)\n\nThis signature derives the key to your zipped coins. It never leaves this browser.\n\nOnly sign this on the official zipcoin site.";

export type MasterKeys = { masterNullifier: bigint; masterSecret: bigint };

export type Note = {
  label: bigint;
  value: bigint;
  nullifier: bigint;
  secret: bigint;
  hash: bigint;
  children: bigint;
  depositIndex: bigint;
  depositor: string;
  depositTx: string;
};

export const mnemonicFromSignature = (sig: Hex) => entropyToMnemonic(hexToBytes(keccak256(sig)).slice(0, 16), wordlist);

export const isMnemonic = (m: string) => validateMnemonic(m.trim().toLowerCase().split(/\s+/).join(" "), wordlist);

/** Same derivation as @0xbow/privacy-pools-core-sdk `generateMasterKeys`, so notes are portable. */
export function masterKeys(mnemonic: string): MasterKeys {
  const m = mnemonic.trim().toLowerCase().split(/\s+/).join(" ");
  const k = (i: number) => bytesToBigInt(mnemonicToAccount(m, { accountIndex: i }).getHdKey().privateKey!);
  return { masterNullifier: poseidon1([k(0)]), masterSecret: poseidon1([k(1)]) };
}

export const depositSecrets = (k: MasterKeys, scope: bigint, index: bigint) => ({
  nullifier: poseidon3([k.masterNullifier, scope, index]),
  secret: poseidon3([k.masterSecret, scope, index]),
});

export const withdrawalSecrets = (k: MasterKeys, label: bigint, index: bigint) => ({
  nullifier: poseidon3([k.masterNullifier, label, index]),
  secret: poseidon3([k.masterSecret, label, index]),
});

/**
 * Rebuilds every live note of a zip key from public pool events. Nothing leaves the browser.
 * Deposit i uses depositSecrets(i); the k-th spend of a note creates a child with withdrawalSecrets(label, k).
 */
export function recoverNotes(k: MasterKeys, scope: bigint, state: PoolStateJson) {
  const byPre = new Map(state.deposits.map((d) => [d.precommitment, d]));
  const bySpent = new Map(state.withdrawals.map((w) => [w.spentNullifier, w]));
  const ragequit = new Set(state.ragequits.map((r) => r.label));
  const notes: Note[] = [];
  let next = 0n;
  let misses = 0;

  for (let i = 0n; misses < 5; i++) {
    const { nullifier, secret } = depositSecrets(k, scope, i);
    const d = byPre.get(hashPrecommitment(nullifier, secret).toString());
    if (!d) {
      misses++;
      continue;
    }
    misses = 0;
    next = i + 1n;

    let note: Note = {
      label: BigInt(d.label),
      value: BigInt(d.value),
      nullifier,
      secret,
      hash: BigInt(d.commitment),
      children: 0n,
      depositIndex: i,
      depositor: d.depositor,
      depositTx: d.tx,
    };
    for (;;) {
      const w = bySpent.get(hashNullifier(note.nullifier).toString());
      if (!w) break;
      const s = withdrawalSecrets(k, note.label, note.children);
      const value = note.value - BigInt(w.value);
      const hash = hashCommitment(value, note.label, hashPrecommitment(s.nullifier, s.secret));
      if (hash.toString() !== w.newCommitment) break;
      note = { ...note, value, nullifier: s.nullifier, secret: s.secret, hash, children: note.children + 1n };
    }
    if (note.value > 0n && !ragequit.has(note.label.toString())) notes.push(note);
  }
  return { notes, nextDepositIndex: next };
}

export const isApproved = (note: Note, state: PoolStateJson) => state.aspLeaves.includes(note.label.toString());

export function context(w: WithdrawalJson, scope: bigint) {
  const enc = encodeAbiParameters(
    [
      { type: "tuple", components: [{ name: "processooor", type: "address" }, { name: "data", type: "bytes" }] },
      { type: "uint256" },
    ],
    [{ processooor: w.processooor, data: w.data }, scope],
  );
  return BigInt(keccak256(enc)) % SNARK_SCALAR_FIELD;
}

async function loadSdk() {
  const sdk = await import("@0xbow/privacy-pools-core-sdk");
  const circuits =
    typeof window === "undefined"
      ? new sdk.Circuits({ browser: false, baseUrl: `file://${process.cwd()}/public/` })
      : new sdk.Circuits({ baseUrl: `${window.location.origin}/` });
  return { sdk, client: new sdk.PrivacyPoolSDK(circuits) };
}

type Groth16 = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

const toSolidity = (proof: Groth16, publicSignals: string[]): ProofJson => ({
  pA: [proof.pi_a[0], proof.pi_a[1]],
  pB: [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ],
  pC: [proof.pi_c[0], proof.pi_c[1]],
  pubSignals: publicSignals.map(String),
});

/** Generates the withdrawal proof in the browser (Groth16, 0xbow ceremony keys). */
export async function proveSpend(k: MasterKeys, note: Note, amount: bigint, w: WithdrawalJson, scope: bigint, state: PoolStateJson) {
  const { sdk, client } = await loadSdk();
  const leaves = state.stateLeaves.map(BigInt);
  const stateProof = proveLeaf(leaves, note.hash);
  const aspProof = proveLeaf(state.aspLeaves.map(BigInt), note.label);
  const next = withdrawalSecrets(k, note.label, note.children);

  const commitment = sdk.getCommitment(note.value, note.label, note.nullifier as never, note.secret as never);
  const { proof, publicSignals } = await client.proveWithdrawal(commitment, {
    context: context(w, scope),
    withdrawalAmount: amount,
    stateMerkleProof: { root: stateProof.root, leaf: note.hash, index: Number(stateProof.index), siblings: stateProof.siblings },
    aspMerkleProof: { root: aspProof.root, leaf: note.label, index: Number(aspProof.index), siblings: aspProof.siblings },
    stateRoot: stateProof.root as never,
    stateTreeDepth: stateProof.depth,
    aspRoot: aspProof.root as never,
    aspTreeDepth: aspProof.depth,
    newNullifier: next.nullifier as never,
    newSecret: next.secret as never,
  });
  return toSolidity(proof as unknown as Groth16, publicSignals as string[]);
}

/** Proof for a public exit to the original depositor (ragequit), used when a deposit is not approved. */
export async function proveExit(note: Note) {
  const { client } = await loadSdk();
  const { proof, publicSignals } = await client.proveCommitment(note.value, note.label, note.nullifier, note.secret);
  return toSolidity(proof as unknown as Groth16, publicSignals as string[]);
}

export const asArgs = (p: ProofJson) => ({
  pA: [BigInt(p.pA[0]), BigInt(p.pA[1])] as const,
  pB: [
    [BigInt(p.pB[0][0]), BigInt(p.pB[0][1])],
    [BigInt(p.pB[1][0]), BigInt(p.pB[1][1])],
  ] as const,
  pC: [BigInt(p.pC[0]), BigInt(p.pC[1])] as const,
  pubSignals: p.pubSignals.map(BigInt),
});
