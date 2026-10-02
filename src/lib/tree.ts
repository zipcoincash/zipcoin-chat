import { LeanIMT } from "@zk-kit/lean-imt";
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";

export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const hashNullifier = (nullifier: bigint) => poseidon1([nullifier]);
export const hashPrecommitment = (nullifier: bigint, secret: bigint) => poseidon2([nullifier, secret]);
export const hashCommitment = (value: bigint, label: bigint, precommitment: bigint) =>
  poseidon3([value, label, precommitment]);

export function buildTree(leaves: bigint[]) {
  const tree = new LeanIMT<bigint>((a, b) => poseidon2([a, b]));
  if (leaves.length) tree.insertMany(leaves);
  return tree;
}

export type TreeProof = { root: bigint; depth: bigint; index: bigint; siblings: bigint[] };

export function proveLeaf(leaves: bigint[], leaf: bigint): TreeProof {
  const tree = buildTree(leaves);
  const i = tree.indexOf(leaf);
  if (i < 0) throw new Error("leaf not in tree");
  const p = tree.generateProof(i);
  const siblings = [...p.siblings];
  while (siblings.length < 32) siblings.push(0n);
  return { root: tree.root, depth: BigInt(tree.depth), index: BigInt(p.index), siblings };
}

export type DepositRow = {
  depositor: string;
  commitment: string;
  label: string;
  value: string;
  precommitment: string;
  block: number;
  logIndex: number;
  tx: string;
};

export type WithdrawRow = {
  processooor: string;
  value: string;
  spentNullifier: string;
  newCommitment: string;
  block: number;
  logIndex: number;
  tx: string;
};

export type RagequitRow = { ragequitter: string; commitment: string; label: string; value: string; block: number; tx: string };

export type SpeechRow = {
  /** Spoken through ZipHearth from an ETH note in 0xbow's pool: anonymous, out of their anonymity set. */
  viaEth?: boolean;
  speaker: string | null;
  /** The door (Doorstep only); null for v1 broadcasts and doorless messages */
  to: string | null;
  nullifierHash: string;
  burned: string;
  gift: string;
  fee: string;
  message: string;
  target: string;
  block: number;
  logIndex: number;
  time: number;
  tx: string;
};

export type PoolStateJson = {
  deposits: DepositRow[];
  withdrawals: WithdrawRow[];
  ragequits: RagequitRow[];
  stateLeaves: string[];
  aspLeaves: string[];
  aspRoot: string;
  head: number;
};
