import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nextgen/ui-lit", "@zitadel/sdk-next"],
};

export default nextConfig;
