import { encodeAbiParameters, type Address, type Hex } from "viem";

/** Entrypoint.relay data: who receives, who is paid for relaying, at what rate. */
export const relayDataParams = [
  { type: "tuple", components: [{ name: "recipient", type: "address" }, { name: "feeRecipient", type: "address" }, { name: "relayFeeBPS", type: "uint256" }] },
] as const;
export const encodeRelayData = (recipient: Address, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(relayDataParams, [{ recipient, feeRecipient, relayFeeBPS }]);

/** ZipChanger.Exchange: deliver a ZC note as ETH to `to`, at least `minOut`, before `deadline`. */
export const paymentParams = [
  {
    type: "tuple",
    components: [
      { name: "to", type: "address" },
      { name: "minOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;
export const encodeExchange = (to: Address, minOut: bigint, deadline: bigint, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(paymentParams, [{ to, minOut, deadline, feeRecipient, relayFeeBPS }]);

export type WithdrawalJson = { processooor: Address; data: Hex };
export type ProofJson = { pA: string[]; pB: string[][]; pC: string[]; pubSignals: string[] };

const speechParams = [
  {
    type: "tuple",
    components: [
      { name: "message", type: "string" },
      { name: "target", type: "string" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
  },
] as const;
/** ZipBroadcaster.speakAnon payload: the words, who they are for, and the relayer's cut (bound into the proof). */
export const encodeSpeech = (message: string, target: string, feeRecipient: Address, relayFeeBPS: bigint) =>
  encodeAbiParameters(speechParams, [{ message, target, feeRecipient, relayFeeBPS }]);
