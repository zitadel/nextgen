import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@zitadel/components",
    "@zitadel/shared-component-styles",
    "@zitadel/design-tokens",
  ],
};

export default nextConfig;
