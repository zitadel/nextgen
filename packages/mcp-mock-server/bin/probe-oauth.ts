import { loadConfig } from "../src/config.js";
import { formatOAuthProbeReport, runOAuthProbe } from "../src/oauth-probe.js";

function parseArgs(argv: string[]): { json: boolean } {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const { json } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const mcpBaseUrl = `http://${config.host}:${config.port}`;

  const report = await runOAuthProbe({
    // Only override discovery when AUTHORIZATION_SERVER is explicitly set.
    // Otherwise use authorization_servers from RFC 9728 metadata (must match the
    // running mock server).
    ...(process.env.AUTHORIZATION_SERVER
      ? { authorizationServerOverride: config.authorizationServer }
      : {}),
    mcpBaseUrl,
    probeClientId: process.env.PROBE_CLIENT_ID,
    probeRedirectUri: process.env.PROBE_REDIRECT_URI,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatOAuthProbeReport(report));
  }

  if (report.summary.fail > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp-oauth-probe] ${message}`);
  process.exit(1);
});
