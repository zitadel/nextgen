import { parseResourceMetadataUrl, probeFetch } from "./mcp-discovery.js";

export type ProbeStatus = "pass" | "fail" | "warn" | "skip";

export type ProbeStep = {
  detail?: string;
  name: string;
  note?: string;
  status: ProbeStatus;
  url: string;
};

export type OAuthProbeReport = {
  authorizationServer?: string;
  authorizeClientId?: string;
  authorizeRedirectUri?: string;
  mcpBaseUrl: string;
  mcpEndpoint: string;
  protectedResourceMetadataUrl?: string;
  registeredClientId?: string;
  resourceUri?: string;
  steps: ProbeStep[];
  summary: {
    fail: number;
    pass: number;
    skip: number;
    warn: number;
  };
};

export type OAuthProbeOptions = {
  authorizationServerOverride?: string;
  fetchImpl?: typeof fetch;
  mcpBaseUrl: string;
  probeClientId?: string;
  probeRedirectUri?: string;
};

async function discoverProbeClientId(
  authorizationServer: string,
  fetchImpl: typeof fetch,
): Promise<{ clientId?: string; redirectUri?: string }> {
  const envUrl = `${trimTrailingSlash(authorizationServer)}/ui/console/assets/environment.json`;
  try {
    const response = await fetchImpl(envUrl);
    if (!response.ok) {
      return {};
    }
    const payload = (await response.json()) as { clientid?: string };
    if (!payload.clientid) {
      return {};
    }
    return {
      clientId: payload.clientid,
      redirectUri: `${trimTrailingSlash(authorizationServer)}/ui/console/auth/callback`,
    };
  } catch {
    return {};
  }
}

type DynamicClientRegistrationResponse = {
  client_id?: string;
  redirect_uris?: string[];
};

type AuthorizeClientSource = "dcr" | "explicit" | "console-fallback" | "placeholder";

type ProtectedResourceMetadata = {
  authorization_servers?: string[];
  resource?: string;
};

type AuthorizationServerMetadata = {
  authorization_endpoint?: string;
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
  issuer?: string;
  registration_endpoint?: string;
  response_types_supported?: string[];
  token_endpoint?: string;
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function summarize(steps: ProbeStep[]): OAuthProbeReport["summary"] {
  return steps.reduce(
    (acc, step) => {
      acc[step.status] += 1;
      return acc;
    },
    { pass: 0, fail: 0, warn: 0, skip: 0 },
  );
}

async function readResponse(
  response: Response,
): Promise<{ body: string; json?: unknown; status: number }> {
  const body = await response.text();
  try {
    return { body, json: JSON.parse(body) as unknown, status: response.status };
  } catch {
    return { body, status: response.status };
  }
}

function step(
  name: string,
  url: string,
  status: ProbeStatus,
  detail?: string,
  note?: string,
): ProbeStep {
  return { name, url, status, detail, note };
}

export async function runOAuthProbe(options: OAuthProbeOptions): Promise<OAuthProbeReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const mcpBaseUrl = trimTrailingSlash(options.mcpBaseUrl);
  const mcpEndpoint = `${mcpBaseUrl}/mcp`;
  const steps: ProbeStep[] = [];

  const mcpResponse = await probeFetch(fetchImpl, mcpEndpoint, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const mcpBody = await readResponse(mcpResponse);
  const wwwAuthenticate = mcpResponse.headers.get("www-authenticate");
  const resourceMetadataFromHeader = parseResourceMetadataUrl(wwwAuthenticate);
  const resourceMetadataUrl =
    resourceMetadataFromHeader ?? `${mcpBaseUrl}/.well-known/oauth-protected-resource`;

  if (mcpResponse.status === 401 && wwwAuthenticate?.includes("resource_metadata=")) {
    steps.push(
      step(
        "MCP resource server challenges unauthenticated requests",
        mcpEndpoint,
        "pass",
        `HTTP ${mcpResponse.status}`,
        wwwAuthenticate,
      ),
    );
  } else {
    steps.push(
      step(
        "MCP resource server challenges unauthenticated requests",
        mcpEndpoint,
        "fail",
        `expected HTTP 401 with resource_metadata, got HTTP ${mcpResponse.status}`,
        mcpBody.body.slice(0, 200),
      ),
    );
  }

  const metadataResponse = await probeFetch(fetchImpl, resourceMetadataUrl);
  const metadataBody = await readResponse(metadataResponse);
  const metadata = metadataBody.json as ProtectedResourceMetadata | undefined;

  if (metadataResponse.status === 200 && metadata?.authorization_servers?.length) {
    steps.push(
      step(
        "Protected resource metadata (RFC 9728)",
        resourceMetadataUrl,
        "pass",
        `authorization_servers=${metadata.authorization_servers.join(", ")}`,
        metadata.resource ? `resource=${metadata.resource}` : undefined,
      ),
    );
  } else {
    steps.push(
      step(
        "Protected resource metadata (RFC 9728)",
        resourceMetadataUrl,
        "fail",
        `HTTP ${metadataResponse.status}`,
        metadataBody.body.slice(0, 200),
      ),
    );
  }

  const authorizationServer = trimTrailingSlash(
    options.authorizationServerOverride ??
      metadata?.authorization_servers?.[0] ??
      "http://localhost:8080",
  );

  const mcpRedirectUri = options.probeRedirectUri ?? "http://127.0.0.1/callback";

  const rfc8414Url = `${authorizationServer}/.well-known/oauth-authorization-server`;
  const rfc8414Response = await probeFetch(fetchImpl, rfc8414Url);
  const rfc8414Body = await readResponse(rfc8414Response);
  let asMetadata: AuthorizationServerMetadata | undefined;
  let asMetadataUrl = rfc8414Url;

  if (rfc8414Response.status === 200) {
    asMetadata = rfc8414Body.json as AuthorizationServerMetadata;
    steps.push(
      step(
        "Authorization server metadata (RFC 8414)",
        rfc8414Url,
        "pass",
        `issuer=${asMetadata.issuer ?? authorizationServer}`,
      ),
    );
  } else {
    steps.push(
      step(
        "Authorization server metadata (RFC 8414)",
        rfc8414Url,
        "fail",
        `HTTP ${rfc8414Response.status}`,
        "MCP clients MUST use this path",
      ),
    );

    const oidcUrl = `${authorizationServer}/.well-known/openid-configuration`;
    const oidcResponse = await probeFetch(fetchImpl, oidcUrl);
    const oidcBody = await readResponse(oidcResponse);
    asMetadataUrl = oidcUrl;

    if (oidcResponse.status === 200) {
      asMetadata = oidcBody.json as AuthorizationServerMetadata;
      steps.push(
        step(
          "OIDC discovery fallback",
          oidcUrl,
          "warn",
          `issuer=${asMetadata.issuer ?? authorizationServer}`,
          "Works for some clients, but MCP requires RFC 8414",
        ),
      );
    } else {
      steps.push(
        step(
          "OIDC discovery fallback",
          oidcUrl,
          "fail",
          `HTTP ${oidcResponse.status}`,
          oidcBody.body.slice(0, 200),
        ),
      );
    }
  }

  const registrationEndpoint =
    asMetadata?.registration_endpoint ?? `${authorizationServer}/oauth/v2/register`;
  const dcrResponse = await probeFetch(fetchImpl, registrationEndpoint, {
    body: JSON.stringify({
      application_type: "native",
      client_name: "mcp-oauth-probe",
      grant_types: ["authorization_code"],
      redirect_uris: [mcpRedirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const dcrBody = await readResponse(dcrResponse);
  const dcrPayload = dcrBody.json as DynamicClientRegistrationResponse | undefined;
  let registeredClientId: string | undefined;
  let authorizeClientId: string | undefined;
  let authorizeRedirectUri = mcpRedirectUri;
  let authorizeClientSource: AuthorizeClientSource = "placeholder";

  if (dcrResponse.status === 200 || dcrResponse.status === 201) {
    registeredClientId = dcrPayload?.client_id;
    authorizeClientId = registeredClientId;
    authorizeRedirectUri = dcrPayload?.redirect_uris?.[0] ?? mcpRedirectUri;
    authorizeClientSource = "dcr";
    steps.push(
      step(
        "Dynamic client registration (RFC 7591)",
        registrationEndpoint,
        "pass",
        `HTTP ${dcrResponse.status}${registeredClientId ? `, client_id=${registeredClientId}` : ""}`,
        `redirect_uri=${authorizeRedirectUri}`,
      ),
    );
  } else {
    steps.push(
      step(
        "Dynamic client registration (RFC 7591)",
        registrationEndpoint,
        "fail",
        `HTTP ${dcrResponse.status}`,
        dcrBody.body.slice(0, 200),
      ),
    );

    if (options.probeClientId) {
      authorizeClientId = options.probeClientId;
      authorizeRedirectUri = mcpRedirectUri;
      authorizeClientSource = "explicit";
      steps.push(
        step(
          "Authorize client selection",
          registrationEndpoint,
          "warn",
          `using PROBE_CLIENT_ID=${authorizeClientId}`,
          "DCR failed; explicit client override in use",
        ),
      );
    } else {
      const consoleClient = await discoverProbeClientId(authorizationServer, fetchImpl);
      if (consoleClient.clientId) {
        authorizeClientId = consoleClient.clientId;
        authorizeRedirectUri = consoleClient.redirectUri ?? mcpRedirectUri;
        authorizeClientSource = "console-fallback";
        steps.push(
          step(
            "Authorize client selection",
            `${authorizationServer}/ui/console/assets/environment.json`,
            "warn",
            `fallback client_id=${authorizeClientId}`,
            "DCR failed; using console client instead of MCP self-registration flow",
          ),
        );
      } else {
        authorizeClientId = "mcp-oauth-probe-client";
        authorizeClientSource = "placeholder";
        steps.push(
          step(
            "Authorize client selection",
            registrationEndpoint,
            "warn",
            "no DCR client and no fallback client discovered",
            "authorize step will likely fail",
          ),
        );
      }
    }
  }

  const authorizeEndpoint =
    asMetadata?.authorization_endpoint ?? `${authorizationServer}/oauth/v2/authorize`;
  const resourceUri = metadata?.resource ?? mcpEndpoint;
  const authorizeUrl = new URL(authorizeEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", authorizeClientId ?? "mcp-oauth-probe-client");
  authorizeUrl.searchParams.set("redirect_uri", authorizeRedirectUri);
  authorizeUrl.searchParams.set("scope", "openid");
  authorizeUrl.searchParams.set("state", "mcp-oauth-probe");
  authorizeUrl.searchParams.set(
    "code_challenge",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", resourceUri);

  let authorizeResponse: Response | undefined;
  let authorizeBody: { body: string; json?: unknown; status: number } | undefined;
  let authorizeAttempts = 0;
  const maxAuthorizeAttempts = authorizeClientSource === "dcr" ? 15 : 1;

  for (let attempt = 1; attempt <= maxAuthorizeAttempts; attempt += 1) {
    authorizeAttempts = attempt;
    authorizeResponse = await probeFetch(fetchImpl, authorizeUrl.toString(), { redirect: "manual" });
    authorizeBody = await readResponse(authorizeResponse);
    const appNotFound = authorizeBody.body.includes("App.NotFound");
    if (!appNotFound || attempt === maxAuthorizeAttempts) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!authorizeResponse || !authorizeBody) {
    throw new Error("authorize probe did not run");
  }

  const location = authorizeResponse.headers.get("location") ?? "";

  if (authorizeBody.body.includes("invalid_target")) {
    steps.push(
      step(
        "Authorization request with RFC 8707 resource parameter",
        authorizeUrl.toString(),
        "fail",
        "authorization server rejected resource parameter",
        authorizeBody.body.slice(0, 200),
      ),
    );
  } else if (
    authorizeResponse.status === 302 ||
    authorizeResponse.status === 303 ||
    location.includes("authorize") ||
    location.includes("login") ||
    location.includes("authRequest=")
  ) {
    const authorizeStatus: ProbeStatus =
      authorizeClientSource === "dcr" || authorizeClientSource === "explicit"
        ? "pass"
        : "warn";
    const authorizeNote =
      authorizeClientSource === "dcr"
        ? authorizeAttempts > 1
          ? `authorize accepted for freshly DCR-registered MCP client after ${authorizeAttempts} attempts; verify issued token aud separately`
          : "authorize accepted for freshly DCR-registered MCP client; verify issued token aud separately"
        : authorizeClientSource === "explicit"
          ? "authorize accepted for explicit probe client; verify issued token aud separately"
          : "authorize reached login, but client was not obtained via MCP self-registration";
    steps.push(
      step(
        "Authorization request with RFC 8707 resource parameter",
        authorizeUrl.toString(),
        authorizeStatus,
        `HTTP ${authorizeResponse.status}`,
        authorizeNote,
      ),
    );
  } else {
    steps.push(
      step(
        "Authorization request with RFC 8707 resource parameter",
        authorizeUrl.toString(),
        "fail",
        `HTTP ${authorizeResponse.status}`,
        authorizeBody.body.slice(0, 200),
      ),
    );
  }

  if (asMetadata?.code_challenge_methods_supported?.includes("S256")) {
    steps.push(
      step("PKCE S256 support advertised", asMetadataUrl, "pass", "code_challenge_methods_supported includes S256"),
    );
  } else {
    steps.push(
      step(
        "PKCE S256 support advertised",
        asMetadataUrl,
        "warn",
        "S256 not advertised in discovery document",
      ),
    );
  }

  if (asMetadata?.response_types_supported?.includes("id_token token")) {
    steps.push(
      step(
        "OAuth 2.1 profile (no implicit flow)",
        asMetadataUrl,
        "warn",
        'response_types_supported still includes implicit-style "id_token token"',
      ),
    );
  } else {
    steps.push(step("OAuth 2.1 profile (no implicit flow)", asMetadataUrl, "pass"));
  }

  return {
    authorizationServer,
    authorizeClientId,
    authorizeRedirectUri,
    mcpBaseUrl,
    mcpEndpoint,
    protectedResourceMetadataUrl: resourceMetadataUrl,
    registeredClientId,
    resourceUri,
    steps,
    summary: summarize(steps),
  };
}

export function formatOAuthProbeReport(report: OAuthProbeReport): string {
  const lines = [
    "MCP OAuth probe report",
    "",
    `MCP endpoint:              ${report.mcpEndpoint}`,
    `Protected resource meta:   ${report.protectedResourceMetadataUrl ?? "(unknown)"}`,
    `Authorization server:      ${report.authorizationServer ?? "(unknown)"}`,
    `Canonical resource URI:    ${report.resourceUri ?? "(unknown)"}`,
    `DCR client_id:           ${report.registeredClientId ?? "(not registered)"}`,
    `Authorize client_id:       ${report.authorizeClientId ?? "(unknown)"}`,
    `Authorize redirect_uri:    ${report.authorizeRedirectUri ?? "(unknown)"}`,
    "",
    `Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skip} skip`,
    "",
  ];

  for (const probeStep of report.steps) {
    const icon =
      probeStep.status === "pass"
        ? "✅"
        : probeStep.status === "warn"
          ? "⚠️"
          : probeStep.status === "skip"
            ? "⏭️"
            : "❌";
    lines.push(`${icon} ${probeStep.name}`);
    lines.push(`   ${probeStep.url}`);
    if (probeStep.detail) {
      lines.push(`   ${probeStep.detail}`);
    }
    if (probeStep.note) {
      lines.push(`   note: ${probeStep.note}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
