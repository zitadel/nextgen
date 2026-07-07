export type McpMockServerConfig = {
  authorizationServer: string;
  host: string;
  introspect: boolean;
  introspectClientId?: string;
  introspectClientSecret?: string;
  port: number;
  publicOrigin: string;
  resourceUri: string;
};

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`invalid PORT="${raw}" — must be an integer between 1 and 65535`);
  }
  return port;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function originFromResourceUri(resourceUri: string): string | undefined {
  try {
    const url = new URL(resourceUri);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

export { originFromResourceUri };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpMockServerConfig {
  const host = env.MCP_MOCK_HOST ?? "localhost";
  const port = parsePort(env.PORT, 9090);
  const origin = `http://${host}:${port}`;
  const authorizationServer = trimTrailingSlash(
    env.AUTHORIZATION_SERVER ?? "http://localhost:8080",
  );
  const resourceUri = trimTrailingSlash(env.MCP_RESOURCE_URI ?? `${origin}/mcp`);
  const publicOrigin = trimTrailingSlash(
    env.MCP_PUBLIC_ORIGIN ?? originFromResourceUri(resourceUri) ?? origin,
  );
  const introspect = env.ZITADEL_INTROSPECT === "1" || env.ZITADEL_INTROSPECT === "true";
  const introspectClientId = env.ZITADEL_INTROSPECT_CLIENT_ID;
  const introspectClientSecret = env.ZITADEL_INTROSPECT_CLIENT_SECRET;

  if (introspect && (!introspectClientId || !introspectClientSecret)) {
    throw new Error(
      "ZITADEL_INTROSPECT is enabled but ZITADEL_INTROSPECT_CLIENT_ID or ZITADEL_INTROSPECT_CLIENT_SECRET is missing",
    );
  }

  return {
    authorizationServer,
    host,
    introspect,
    introspectClientId,
    introspectClientSecret,
    port,
    publicOrigin,
    resourceUri,
  };
}
