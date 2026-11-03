import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// The hosted cloud's functions (root ADR 084): route handlers only, under
// /cloud/, which repo-root vercel.json routes to this service. withWorkflow
// compiles the "use workflow" and "use step" functions in src/workflows.
const config: NextConfig = {
  reactStrictMode: true,
  // Keeps `next dev` from writing Next's agent rules into AGENTS.md when an
  // AI coding agent runs it (apps/AGENTS.md).
  agentRules: false,
};

export default withWorkflow(config);
