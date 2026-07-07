import { loadConfig, originFromResourceUri } from "../src/config.js";
import { discoverMcpResourceContext } from "../src/mcp-discovery.js";
import { formatTokenProbeReport, runTokenProbe } from "../src/token-probe.js";

function parseArgs(argv: string[]): {
  authorizationCode?: string;
  callbackPort: number;
  cimd: boolean;
  json: boolean;
  noOpen: boolean;
} {
  let json = false;
  let noOpen = false;
  let cimd = false;
  let callbackPort = 8765;
  let authorizationCode: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--cimd") {
      cimd = true;
    } else if (arg === "--code") {
      authorizationCode = argv[index + 1];
      index += 1;
    } else if (arg === "--callback-port") {
      const raw = argv[index + 1];
      callbackPort = Number.parseInt(raw ?? "", 10);
      if (!Number.isFinite(callbackPort)) {
        throw new Error(`invalid --callback-port value: ${raw}`);
      }
      index += 1;
    }
  }

  return { authorizationCode, callbackPort, cimd, json, noOpen };
}

async function main(): Promise<void> {
  const { authorizationCode, callbackPort, cimd, json, noOpen } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const mcpBaseUrl = `http://${config.host}:${config.port}`;
  const context = await discoverMcpResourceContext({
    mcpBaseUrl,
    ...(process.env.AUTHORIZATION_SERVER
      ? { authorizationServerOverride: config.authorizationServer }
      : {}),
  });
  const publicOrigin =
    process.env.MCP_PUBLIC_ORIGIN || process.env.MCP_RESOURCE_URI
      ? config.publicOrigin
      : (originFromResourceUri(context.resourceUri) ?? config.publicOrigin);

  const report = await runTokenProbe({
    authorizationCode,
    authorizationServer: context.authorizationServer,
    callbackPort,
    clientRegistration: cimd ? "cimd" : "dcr",
    mcpBaseUrl,
    mcpEndpoint: context.mcpEndpoint,
    openBrowser: !noOpen,
    publicOrigin,
    resourceUri: process.env.MCP_RESOURCE_URI ? config.resourceUri : context.resourceUri,
  });

  if (json) {
    const printable = {
      ...report,
      accessToken: report.accessToken ? "<redacted>" : undefined,
      tokenResponse: report.tokenResponse
        ? {
            ...report.tokenResponse,
            access_token:
              typeof report.tokenResponse.access_token === "string" ? "<redacted>" : undefined,
            id_token:
              typeof report.tokenResponse.id_token === "string" ? "<redacted>" : undefined,
            refresh_token:
              typeof report.tokenResponse.refresh_token === "string" ? "<redacted>" : undefined,
          }
        : undefined,
    };
    console.log(JSON.stringify(printable, null, 2));
  } else {
    console.log(formatTokenProbeReport(report));
  }

  if (report.steps.some((probeStep) => probeStep.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mcp-token-probe] ${message}`);
  process.exit(1);
});
