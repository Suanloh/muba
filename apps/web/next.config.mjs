/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (main → ./src/index.ts); let
  // Next transpile them so the app can import @mova/* directly.
  transpilePackages: [
    "@mova/types",
    "@mova/config",
    "@mova/logger",
    "@mova/core",
    "@mova/wallet",
    "@mova/ai",
  ],
  webpack: (config) => {
    // The MOVA packages import with `.js` specifiers (TS convention) but ship
    // `.ts` source. Map `.js` → `.ts`/`.tsx` before falling back to real `.js`.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  experimental: {
    // MOVA never ships secrets to the client — keep env explicit.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
