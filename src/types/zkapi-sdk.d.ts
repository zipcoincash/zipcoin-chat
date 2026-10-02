// The pinned zkAPI browser SDK ships plain ESM without types; we type only what we call (src/lib/zkapi.ts).
declare module "@openanonymity/zkapi-browser-sdk" {
  export function configureBrowserSdk(o: { configUrl?: string; workerUrl?: string; transport?: unknown; mode?: "browser" }): unknown;
  export const CHAT_SPENDING_TIER_USD: readonly number[];
}
declare module "@openanonymity/zkapi-browser-sdk/client" {
  const client: unknown;
  export default client;
}
declare module "@openanonymity/zkapi-browser-sdk/build" {
  export function buildBrowserSdkAssets(o: { outDir: string; publicPath: string; network: "mainnet" | "sepolia"; build: unknown }): Promise<{ files: Record<string, string>; config: Record<string, unknown>; configUrl: string; workerUrl: string }>;
}
