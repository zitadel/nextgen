import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@zitadel/components",
    "@zitadel/design-tokens",
  ],
};

export default nextConfig;
