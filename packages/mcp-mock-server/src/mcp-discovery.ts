export type ProtectedResourceMetadata = {
  authorization_servers?: string[];
  resource?: string;
};

export type McpResourceContext = {
  authorizationServer: string;
  mcpEndpoint: string;
  protectedResourceMetadataUrl: string;
  resourceUri: string;
};

export type DiscoverMcpResourceContextOptions = {
  authorizationServerOverride?: string;
  fetchImpl?: typeof fetch;
  mcpBaseUrl: string;
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function parseResourceMetadataUrl(wwwAuthenticate: string | null): string | undefined {
  if (!wwwAuthenticate) {
    return undefined;
  }
  const match = wwwAuthenticate.match(/resource_metadata="([^"]+)"/i);
  return match?.[1];
}

function formatFetchError(url: string, method: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause instanceof Error && "code" in cause
      ? String((cause as NodeJS.ErrnoException).code)
      : undefined;
  let hint = "";
  if (code === "ECONNREFUSED") {
    if (url.includes("/mcp")) {
      hint =
        " — is the mock MCP server running? Start it with: corepack pnpm --filter @zitadel/mcp-mock-server start";
    } else {
      hint =
        " — is the metadata URL reachable? Restart the mock server without stale tunnel env vars, or set AUTHORIZATION_SERVER explicitly";
    }
  }
  return new Error(`${method} ${url} failed: ${message}${hint}`, { cause: error });
}

export async function probeFetch(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  try {
    return await fetchImpl(url, init);
  } catch (error: unknown) {
    throw formatFetchError(url, method, error);
  }
}

export async function discoverMcpResourceContext(
  options: DiscoverMcpResourceContextOptions,
): Promise<McpResourceContext> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const mcpBaseUrl = trimTrailingSlash(options.mcpBaseUrl);
  const mcpEndpoint = `${mcpBaseUrl}/mcp`;

  const mcpResponse = await probeFetch(fetchImpl, mcpEndpoint, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const wwwAuthenticate = mcpResponse.headers.get("www-authenticate");
  const protectedResourceMetadataUrl =
    parseResourceMetadataUrl(wwwAuthenticate) ??
    `${mcpBaseUrl}/.well-known/oauth-protected-resource`;

  const metadataResponse = await probeFetch(fetchImpl, protectedResourceMetadataUrl);
  const metadataBody = await metadataResponse.text();
  let metadata: ProtectedResourceMetadata | undefined;
  try {
    metadata = JSON.parse(metadataBody) as ProtectedResourceMetadata;
  } catch {
    metadata = undefined;
  }

  if (metadataResponse.status !== 200 || !metadata?.authorization_servers?.length) {
    throw new Error(
      `protected resource metadata unavailable at ${protectedResourceMetadataUrl} (HTTP ${metadataResponse.status})`,
    );
  }

  const authorizationServer = trimTrailingSlash(
    options.authorizationServerOverride ?? metadata.authorization_servers[0] ?? "",
  );
  if (!authorizationServer) {
    throw new Error("protected resource metadata did not include authorization_servers");
  }

  return {
    authorizationServer,
    mcpEndpoint,
    protectedResourceMetadataUrl,
    resourceUri: trimTrailingSlash(metadata.resource ?? mcpEndpoint),
  };
}
