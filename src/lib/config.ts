import type { Address } from "viem";

/** Everything public about zipcoin and zkAPI on Ethereum mainnet. Verified on Etherscan; see zipcoin.cash/docs#contracts. */
export const CHAIN_ID = 1;
/** The zipcoin site: pool state, relayer, quotes. Its API allows this origin. */
export const ZIPCOIN_API = process.env.NEXT_PUBLIC_ZIPCOIN_API ?? "https://www.zipcoin.cash";
/** The public site (the Book lives there). */
export const ZIPCOIN_SITE = process.env.NEXT_PUBLIC_ZIPCOIN_SITE ?? "https://www.zipcoin.cash";
/** Chain reads and the throwaway key's broadcasts. On a fork, both point at anvil. */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://etherscan.io";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://chat.zipcoin.cash";

export const ADDR = {
  zc: (process.env.NEXT_PUBLIC_ZC ?? "0x4E67DB19044549fF420860834c91b45BaD298722") as Address,
  entrypoint: (process.env.NEXT_PUBLIC_ENTRYPOINT ?? "0x7a8DA01D241C3cFcF7803cdB007EcE5663749193") as Address,
  pool: (process.env.NEXT_PUBLIC_POOL ?? "0x6d0eBA4D1E2665bF2256507E8b0124C647ada422") as Address,
  /** ZipChanger: a ZC note delivered as ETH to a bound address. */
  changer: (process.env.NEXT_PUBLIC_CHANGER ?? "0x858f4156E3C8319CA4dF14d3b46e398E0EFf3295") as Address,
  /** ZipBroadcaster: burn ZC to put a message on Ethereum (the Book). */
  broadcaster: (process.env.NEXT_PUBLIC_BROADCASTER ?? "0x992550B536749125D63d5F9c19fea765232D6928") as Address,
  bowEntrypoint: "0x6818809EefCe719E480a7526D76bD3e561526b46" as Address,
  bowEthPool: "0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB" as Address,
  /** zkAPI's native ETH vault (Open Anonymity + EF dAI). Pinned again in public/zkapi/browser-config.json. */
  zkapiVault: "0x4386FDbdA35D995beB3BF8625118Ec5982ec81fe" as Address,
  ethUsdFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" as Address,
};

export const SCOPE_ZC = BigInt(process.env.NEXT_PUBLIC_SCOPE ?? "15272855998697339604342058151649103501360401326327795051058889250396111180967");
export const SCOPE_ETH = 4916574638117198869413701114161172350986437430914933850166949084132905299523n;

/** Gas a zkAPI deposit and a close each burn (64 Poseidon hashes on chain): measured 6.74M per mainnet deposit. */
export const ZKAPI_DEPOSIT_GAS = 6_900_000n;
export const ZKAPI_CLOSE_GAS = 7_000_000n;
/** Smallest funding we let through, in dollars, whatever gas says. */
export const MIN_FUND_USD = 20;

export const ZIPCOIN_URL = "https://www.zipcoin.cash";
export const ZKAPI_URL = "https://github.com/ethereum/zkapi";
export const OA_URL = "https://openanonymity.ai";

/** The Book: a burn must be at least the contract's MIN_BURN (1,000 ZC) and the site's floor in dollars; a message is 280 bytes. */
export const MIN_BURN = 1_000n * 10n ** 18n;
export const MIN_BURN_USD = 10;
export const MAX_MESSAGE_BYTES = 280;
