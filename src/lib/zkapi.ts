"use client";

import type { PrivateKeyAccount } from "viem/accounts";

import { localProvider, type LocalProvider } from "./provider";

/**
 * The zkAPI browser SDK (Open Anonymity + EF dAI, pinned git revision), driven by our throwaway key instead of MetaMask.
 * Everything private (note secret, blindings, proofs, the runtime key) stays in the SDK's IndexedDB and web worker.
 * This module only orders the calls and types what the host needs.
 */
export type NoteStatus = { note_id: number; deposit_amount: number | string; current_balance: number | string; expiry_ts: number; is_genesis: boolean };
export type WalletStatus = { has_note: boolean; pending_request: boolean; note: NoteStatus | null } | null;
export type Activity = { id: string; kind: string; phase: string; title?: string; message?: string; blocksSend?: boolean; error?: unknown };
export type DepositRecord = { noteId?: number; status: string; amount?: number | string; transactionHash?: string; feeWei?: string; expiryTs?: number; expiryClaim?: unknown };
export type WithdrawalRecord = { id?: string; noteId?: number; mode?: string; status: string; destination?: string; transactionHash?: string; finalizeAfter?: number };
export type Snapshot = {
  wallet: WalletStatus;
  walletAddress: string | null;
  withdrawal: unknown;
  withdrawals: WithdrawalRecord[];
  deposits: DepositRecord[];
  challengePeriodSeconds: number;
  loading: boolean;
  lastError: unknown;
  initialized: boolean;
  activities: Activity[];
  config: { active_lease?: { session_id: string; expires_at: number; spending_limit_usd: number } | null; pending_deposit?: { operation_id?: string | null; phase?: string; amount?: number; next_note_id?: number; transaction_hash?: string | null; transaction_hashes?: string[] } | null } | null;
};
export type Access = { mode: string; apiKey: string; baseUrl: string; spendingLimitUsd: number; headers: Record<string, string>; release: () => void };
export type PreparedQuote = { operationId: string; commitment: string; amount: string; depositWei: string; chainId: number; contractAddress: string; transaction: { from: string; to: string; data: `0x${string}`; value: `0x${string}` } };
export type PriceQuote = { answer: string; decimals: number; updated_at: number; round_id: string };
export type Tier = 1 | 2 | 3 | 4.5 | 6;

type SdkClient = {
  init(): Promise<unknown>;
  subscribe(fn: (s: Snapshot) => void): () => void;
  snapshot(): Snapshot;
  setWalletProvider(p: unknown): void;
  refresh(o?: { quiet?: boolean }): Promise<unknown>;
  refreshEthUsdPrice(o?: { signal?: AbortSignal }): Promise<PriceQuote>;
  quoteDepositUsd(usd: string): Promise<{ amount: string; ethAmount: string; depositWei: string; usdAmount: string; price: PriceQuote }>;
  prepareDepositQuote(ethAmount: string, o: { from: string }): Promise<PreparedQuote>;
  deposit(ethAmount: string, onStatus: (s: string) => void, o?: { preparedOperationId?: string | null }): Promise<unknown>;
  recoverBrowserDeposit(onStatus?: (s: string) => void): Promise<{ status?: string; transactionHash?: string } | null>;
  prepareDepositRetry(onStatus?: (s: string) => void): Promise<unknown>;
  acquireInferenceAccess(sessionId: string, o: { spendingLimitUsd: Tier; signal?: AbortSignal; onProgress?: (p: { phase: string; message: string }) => void }): Promise<Access>;
  settleActiveLease(onStatus?: (s: string) => void, o?: { sessionId?: string | null }): Promise<unknown>;
  withdraw(mode: "mutual" | "escape", onStatus: (s: string) => void, o?: { destination?: string }): Promise<unknown>;
  syncWithdrawal(onStatus?: (s: string) => void): Promise<unknown>;
  syncEscapeWithdrawals(onStatus?: (s: string) => void): Promise<unknown>;
  formatMoney(units: number | string): string;
  formatBillingAmount(units: number | string): string;
  formatExpiry(ts: number): string;
  readonly hasNote: boolean;
  readonly note: NoteStatus | null;
  readonly creditsPerUsd: number;
  readonly isNativeEthFunding: boolean;
  readonly initialized: boolean;
};

let sdk: Promise<{ client: SdkClient; tiers: readonly number[] }> | null = null;
let provider: LocalProvider | null = null;

export const TIERS: Tier[] = [1, 2, 3, 4.5, 6];

/** Configure once, init once; the SDK itself enforces that order. */
export function zkapi(account: PrivateKeyAccount) {
  if (!provider || provider.address !== account.address) provider = localProvider(account);
  sdk ??= (async () => {
    const [{ configureBrowserSdk, CHAT_SPENDING_TIER_USD }, { default: client }] = await Promise.all([
      import("@openanonymity/zkapi-browser-sdk"),
      import("@openanonymity/zkapi-browser-sdk/client"),
    ]);
    configureBrowserSdk({ configUrl: "/zkapi/browser-config.json", workerUrl: "/zkapi/assets/zkapiWasmWorker.js" });
    const c = client as unknown as SdkClient;
    c.setWalletProvider(provider);
    await c.init();
    return { client: c, tiers: CHAT_SPENDING_TIER_USD as readonly number[] };
  })();
  return sdk;
}

export const currentProvider = () => provider;

/** Units are whole gwei; 1e9 per ETH. */
export const gweiToEth = (units: number | string | bigint) => Number(units) / 1e9;
export const usdOf = (units: number | string | bigint, price: PriceQuote | null) => (price ? (Number(units) / 1e9) * (Number(price.answer) / 10 ** price.decimals) : null);

/** The SDK narrates for a MetaMask user; here the signer is the throwaway funding key and nothing pops up. */
export const humanize = (s: string) => s.replace(/confirm in MetaMask\.?/gi, "signed by the funding key.").replace(/Confirm [^.]* in MetaMask…?/g, "Signing with the funding key…").replace(/Connecting to MetaMask…?/g, "Using the funding key…").replace(/MetaMask/g, "the funding key");
