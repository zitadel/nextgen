import { ZitadelError } from "../errors";
import { unscopedCommand } from "../suggestion";

/**
 * The CLI's client id at every server: a first-party public client of the
 * platform project's `zitadel` app, which the server declares in code.
 */
export const CLI_CLIENT_ID = "cli";

/** What a server's discovery documents say about signing a developer in. */
export type ServerAuthorization = Readonly<{
  /** The platform API's identifier: the `resource` and the token's `aud`. */
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
}>;

export type Fetch = typeof fetch;

/**
 * Finds where to sign in to `server`, the way an MCP client finds it for an
 * MCP server: the platform API's protected-resource metadata (RFC 9728) names
 * its authorization server, whose metadata (RFC 8414) names the endpoints.
 * Nothing is compiled in but the client id.
 */
export async function discoverAuthorization(
  server: string,
  fetchFn: Fetch = fetch,
): Promise<ServerAuthorization> {
  const resource = await getJson(
    fetchFn,
    new URL("/.well-known/oauth-protected-resource", server).toString(),
  );
  const issuer = Array.isArray(resource?.authorization_servers)
    ? resource.authorization_servers[0]
    : undefined;
  if (typeof resource?.resource !== "string" || typeof issuer !== "string") {
    throw notOffered(server);
  }
  const metadata = await getJson(fetchFn, authorizationServerMetadataUrl(issuer));
  if (
    metadata?.issuer !== issuer ||
    typeof metadata.authorization_endpoint !== "string" ||
    typeof metadata.token_endpoint !== "string"
  ) {
    throw new ZitadelError("E_VALIDATION", `${issuer} publishes no usable sign-in metadata.`);
  }
  const methods = metadata.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes("S256")) {
    throw new ZitadelError("E_VALIDATION", `${issuer} does not support PKCE with S256.`);
  }
  return {
    resource: resource.resource,
    issuer,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    ...(typeof metadata.revocation_endpoint === "string"
      ? { revocationEndpoint: metadata.revocation_endpoint }
      : {}),
  };
}

/**
 * RFC 8414 §3.1: the well-known segment goes between the issuer's host and
 * its path, `https://h/.well-known/oauth-authorization-server/oauth/proj_x`.
 */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

// biome-ignore lint/suspicious/noExplicitAny: discovery documents are untyped JSON, checked field by field.
async function getJson(fetchFn: Fetch, url: string): Promise<any> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new ZitadelError("E_NETWORK", `Could not reach ${new URL(url).origin}.`, {
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new ZitadelError("E_NETWORK", `${url} answered ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function notOffered(server: string): ZitadelError {
  return new ZitadelError(
    "E_NOT_IMPLEMENTED",
    `${server} does not offer developer sign-in: it publishes no protected-resource metadata.`,
    {
      hint: "The server needs platform.oauth.enabled (NEXTGEN_PLATFORM_OAUTH_ENABLED=true) and its platform project. Project commands still work with the project secret.",
      nextCommands: [unscopedCommand("doctor")],
    },
  );
}
