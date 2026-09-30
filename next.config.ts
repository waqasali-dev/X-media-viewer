import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep DOM-emulating / browser-driving packages out of the server bundle.
  serverExternalPackages: ["x-client-transaction-id", "linkedom", "playwright-core"],
  reactStrictMode: true,
};

export default nextConfig;
