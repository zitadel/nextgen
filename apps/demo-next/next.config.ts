import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keeps `next dev` from writing Next's agent rules into AGENTS.md when an
  // AI coding agent runs it (apps/AGENTS.md).
  agentRules: false,
};

export default nextConfig;
