import type { NextConfig } from "next";

/** zkAPI's protocol server and indexer send no CORS headers, so the SDK talks to them through this same-origin pass-through
 *  (prompt-free protocol traffic only: quotes, Merkle snapshots, proofs, settlement). Prompts go browser → provider directly. */
const ZKAPI = process.env.ZKAPI_SERVER ?? "https://zkapi-mainnet.openanonymity.ai";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return [{ source: "/zkapi-deployment/:path*", destination: `${ZKAPI}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/zkapi/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
