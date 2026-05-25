import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@zitadel-nextgen/components",
    "@zitadel-nextgen/shared-component-styles",
    "@zitadel-nextgen/design-tokens",
  ],
};

export default nextConfig;
