import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCodeChallenge, createPkcePair } from "./pkce.js";
import { audienceMatchesResource, decodeJwt } from "./jwt.js";
import { cimdClientIdUrl, cimdRedirectUri, isCimdCompatibleOrigin } from "./cimd.js";

export type ClientRegistrationMode = "dcr" | "cimd";

export type TokenProbeSession = {
  authorizationServer: string;
  clientId: string;
  clientRegistration: ClientRegistrationMode;
  codeVerifier: string;
  mcpBaseUrl: string;
  mcpEndpoint: string;
  redirectUri: string;
  resourceUri: string;
  state: string;
};

export type TokenProbeStep = {
  detail?: string;
  name: string;
  note?: string;
  status: "pass" | "fail" | "warn" | "skip";
};

export type TokenProbeReport = {
  accessToken?: string;
  authorizationCode?: string;
  authorizationServer: string;
  authorizeUrl: string;
  clientId?: string;
  mcpEndpoint: string;
  redirectUri: string;
  resourceUri: string;
  steps: TokenProbeStep[];
  tokenClaims?: Record<string, unknown>;
  tokenResponse?: Record<string, unknown>;
};

export type TokenProbeOptions = {
  authorizationCode?: string;
  authorizationServer: string;
  callbackPort?: number;
  callbackTimeoutMs?: number;
  clientRegistration?: ClientRegistrationMode;
  fetchImpl?: typeof fetch;
  mcpBaseUrl: string;
  mcpEndpoint: string;
  openBrowser?: boolean;
  publicOrigin?: string;
  redirectUri?: string;
  resourceUri: string;
  sessionFile?: string;
};

const DEFAULT_SESSION_FILE = path.join(process.cwd(), ".mcp-token-probe-session.json");

export async function saveTokenProbeSession(
  sessionFile: string,
  session: TokenProbeSession,
): Promise<void> {
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export async function loadTokenProbeSession(sessionFile: string): Promise<TokenProbeSession | undefined> {
  try {
    const raw = await readFile(sessionFile, "utf8");
    return JSON.parse(raw) as TokenProbeSession;
  } catch {
    return undefined;
  }
}

type DynamicClientRegistrationResponse = {
  client_id?: string;
  redirect_uris?: string[];
};

function step(
  name: string,
  status: TokenProbeStep["status"],
  detail?: string,
  note?: string,
): TokenProbeStep {
  return { name, status, detail, note };
}

async function readJson(response: Response): Promise<{ body: string; json?: unknown; status: number }> {
  const body = await response.text();
  try {
    return { body, json: JSON.parse(body) as unknown, status: response.status };
  } catch {
    return { body, status: response.status };
  }
}

export async function registerDynamicClient(
  authorizationServer: string,
  redirectUri: string,
  fetchImpl: typeof fetch,
): Promise<{ clientId: string; registrationEndpoint: string }> {
  const registrationEndpoint = `${authorizationServer}/oauth/v2/register`;
  const response = await fetchImpl(registrationEndpoint, {
    body: JSON.stringify({
      application_type: "native",
      client_name: "mcp-token-probe",
      grant_types: ["authorization_code"],
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = await readJson(response);
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `DCR failed with HTTP ${response.status}: ${payload.body.slice(0, 300)}`,
    );
  }
  const clientId = (payload.json as DynamicClientRegistrationResponse | undefined)?.client_id;
  if (!clientId) {
    throw new Error("DCR succeeded but response did not include client_id");
  }
  return { clientId, registrationEndpoint };
}

export async function waitForOAuthCallbackViaMockServer(input: {
  fetchImpl: typeof fetch;
  mcpBaseUrl: string;
  state: string;
  timeoutMs: number;
}): Promise<string> {
  const deadline = Date.now() + input.timeoutMs;
  const pollUrl = `${input.mcpBaseUrl}/_probe/oauth/callback`;
  while (Date.now() < deadline) {
    const response = await input.fetchImpl(
      `${pollUrl}?state=${encodeURIComponent(input.state)}`,
    );
    if (response.status === 200) {
      const payload = (await response.json()) as { code?: string };
      if (payload.code) {
        return payload.code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `timed out after ${input.timeoutMs}ms waiting for OAuth callback on ${pollUrl}`,
  );
}

export function buildAuthorizeUrl(input: {
  authorizationServer: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resourceUri: string;
  state: string;
}): string {
  const url = new URL(`${input.authorizationServer}/oauth/v2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resourceUri);
  return url.toString();
}

export function waitForAuthorizationCode(
  redirectUri: string,
  expectedState: string,
  timeoutMs: number,
): Promise<{ code: string; state: string }> {
  const callbackUrl = new URL(redirectUri);
  const hostname = callbackUrl.hostname;
  const port = callbackUrl.port
    ? Number.parseInt(callbackUrl.port, 10)
    : callbackUrl.protocol === "https:"
      ? 443
      : 80;
  const pathname = callbackUrl.pathname;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (requestUrl.pathname !== pathname) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`authorization error: ${error}`));
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state") ?? "";
      if (!code) {
        res.statusCode = 400;
        res.end("missing code");
        return;
      }
      if (state !== expectedState) {
        res.statusCode = 400;
        res.end("invalid state");
        server.close();
        reject(new Error("callback state mismatch"));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Authorization complete. You can close this tab and return to the terminal.");
      server.close();
      resolve({ code, state });
    });

    server.once("error", reject);
    server.listen(port, hostname, () => {
      // listener ready
    });

    setTimeout(() => {
      server.close();
      reject(new Error(`timed out after ${timeoutMs}ms waiting for OAuth callback`));
    }, timeoutMs);
  });
}

export async function exchangeAuthorizationCode(input: {
  authorizationServer: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  fetchImpl: typeof fetch;
  redirectUri: string;
  resourceUri: string;
}): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    resource: input.resourceUri,
  });
  const response = await input.fetchImpl(`${input.authorizationServer}/oauth/v2/token`, {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`token exchange failed with HTTP ${response.status}: ${payload.body.slice(0, 300)}`);
  }
  return (payload.json ?? {}) as Record<string, unknown>;
}

export async function callMcpEndpoint(
  mcpEndpoint: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ body: string; status: number }> {
  const response = await fetchImpl(mcpEndpoint, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize" }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = await response.text();
  return { body, status: response.status };
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.unref();
    resolve();
  });
}

export async function runTokenProbe(options: TokenProbeOptions): Promise<TokenProbeReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const callbackPort = options.callbackPort ?? 8765;
  const mcpBaseUrl = options.mcpBaseUrl.replace(/\/$/, "");
  const clientRegistration = options.clientRegistration ?? "dcr";
  const redirectUri =
    options.redirectUri ??
    (clientRegistration === "cimd"
      ? cimdRedirectUri(options.publicOrigin ?? "")
      : `http://127.0.0.1:${callbackPort}/callback`);
  const sessionFile = options.sessionFile ?? DEFAULT_SESSION_FILE;
  const steps: TokenProbeStep[] = [];
  const state = "mcp-token-probe";

  let clientId: string;
  let codeVerifier: string;
  let activeRegistration = clientRegistration;

  if (options.authorizationCode) {
    const savedSession = await loadTokenProbeSession(sessionFile);
    if (!savedSession) {
      throw new Error(
        `no persisted session at ${sessionFile}; run probe-token --no-open first and complete login with the printed URL`,
      );
    }
    clientId = savedSession.clientId;
    codeVerifier = savedSession.codeVerifier;
    activeRegistration = savedSession.clientRegistration;
    steps.push(
      step(
        "Reuse persisted probe session",
        "pass",
        `client_id=${clientId}`,
        sessionFile,
      ),
    );
  } else if (clientRegistration === "cimd") {
    if (!options.publicOrigin || !isCimdCompatibleOrigin(options.publicOrigin)) {
      throw new Error(
        "CIMD requires MCP_PUBLIC_ORIGIN=https://… so the mock server can host metadata and callbacks on a public HTTPS origin",
      );
    }
    const pkce = createPkcePair();
    codeVerifier = pkce.codeVerifier;
    clientId = cimdClientIdUrl(options.publicOrigin);
    steps.push(
      step(
        "Client ID Metadata Document (CIMD) client",
        "pass",
        `client_id=${clientId}`,
        redirectUri,
      ),
    );

    await saveTokenProbeSession(sessionFile, {
      authorizationServer: options.authorizationServer,
      clientId,
      clientRegistration: "cimd",
      codeVerifier,
      mcpBaseUrl,
      mcpEndpoint: options.mcpEndpoint,
      redirectUri,
      resourceUri: options.resourceUri,
      state,
    });
    steps.push(step("Persist probe session", "pass", sessionFile));
  } else {
    const pkce = createPkcePair();
    codeVerifier = pkce.codeVerifier;
    const registered = await registerDynamicClient(
      options.authorizationServer,
      redirectUri,
      fetchImpl,
    );
    clientId = registered.clientId;
    steps.push(
      step(
        "Dynamic client registration",
        "pass",
        `client_id=${clientId}`,
        registered.registrationEndpoint,
      ),
    );

    await saveTokenProbeSession(sessionFile, {
      authorizationServer: options.authorizationServer,
      clientId,
      clientRegistration: "dcr",
      codeVerifier,
      mcpBaseUrl,
      mcpEndpoint: options.mcpEndpoint,
      redirectUri,
      resourceUri: options.resourceUri,
      state,
    });
    steps.push(step("Persist probe session", "pass", sessionFile));
  }

  const authorizeUrl = buildAuthorizeUrl({
    authorizationServer: options.authorizationServer,
    clientId,
    codeChallenge: createCodeChallenge(codeVerifier),
    redirectUri,
    resourceUri: options.resourceUri,
    state,
  });

  let authorizationCode = options.authorizationCode;
  if (!authorizationCode) {
    if (options.openBrowser !== false) {
      try {
        await openBrowser(authorizeUrl);
        steps.push(step("Open authorize URL in browser", "pass", authorizeUrl));
      } catch {
        steps.push(
          step(
            "Open authorize URL in browser",
            "warn",
            authorizeUrl,
            "could not launch a browser automatically; open the URL manually",
          ),
        );
      }
    } else {
      steps.push(
        step(
          "Authorize in browser",
          "skip",
          authorizeUrl,
          "complete login, then rerun with --code <authorization_code>",
        ),
      );
      return {
        authorizationServer: options.authorizationServer,
        authorizeUrl,
        clientId,
        mcpEndpoint: options.mcpEndpoint,
        redirectUri,
        resourceUri: options.resourceUri,
        steps,
      };
    }

    try {
      const callback =
        activeRegistration === "cimd"
          ? await waitForOAuthCallbackViaMockServer({
              fetchImpl,
              mcpBaseUrl,
              state,
              timeoutMs: options.callbackTimeoutMs ?? 5 * 60 * 1000,
            })
          : await waitForAuthorizationCode(
              redirectUri,
              state,
              options.callbackTimeoutMs ?? 5 * 60 * 1000,
            );
      authorizationCode = callback;
      steps.push(step("Receive authorization callback", "pass", `code received for state=${state}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push(step("Receive authorization callback", "fail", message, authorizeUrl));
      return {
        authorizationServer: options.authorizationServer,
        authorizeUrl,
        clientId,
        mcpEndpoint: options.mcpEndpoint,
        redirectUri,
        resourceUri: options.resourceUri,
        steps,
      };
    }
  } else {
    steps.push(step("Use provided authorization code", "pass", "skipped callback server"));
  }

  if (!authorizationCode) {
    throw new Error("authorization code missing");
  }

  let tokenResponse: Record<string, unknown>;
  try {
    tokenResponse = await exchangeAuthorizationCode({
      authorizationServer: options.authorizationServer,
      clientId,
      code: authorizationCode,
      codeVerifier,
      fetchImpl,
      redirectUri,
      resourceUri: options.resourceUri,
    });
    steps.push(step("Exchange authorization code for tokens", "pass", "token endpoint returned 200"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push(step("Exchange authorization code for tokens", "fail", message));
    return {
      authorizationCode,
      authorizationServer: options.authorizationServer,
      authorizeUrl,
      clientId,
      mcpEndpoint: options.mcpEndpoint,
      redirectUri,
      resourceUri: options.resourceUri,
      steps,
    };
  }

  const accessToken = typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : undefined;
  if (!accessToken) {
    steps.push(step("Read access_token from token response", "fail", JSON.stringify(tokenResponse).slice(0, 300)));
    return {
      authorizationCode,
      authorizationServer: options.authorizationServer,
      authorizeUrl,
      clientId,
      mcpEndpoint: options.mcpEndpoint,
      redirectUri,
      resourceUri: options.resourceUri,
      steps,
      tokenResponse,
    };
  }

  const decoded = decodeJwt(accessToken);
  const tokenClaims = decoded?.payload;
  if (!tokenClaims) {
    steps.push(
      step(
        "Decode access token claims",
        "warn",
        "token is opaque or not a JWT",
        "audience check skipped",
      ),
    );
  } else {
    const audienceOk = audienceMatchesResource(tokenClaims, options.resourceUri);
    steps.push(
      step(
        "Access token audience matches MCP resource URI (RFC 8707)",
        audienceOk ? "pass" : "fail",
        `aud=${JSON.stringify(tokenClaims.aud)}`,
        `expected resource=${options.resourceUri}`,
      ),
    );
  }

  const mcpResult = await callMcpEndpoint(options.mcpEndpoint, accessToken, fetchImpl);
  if (mcpResult.status === 200) {
    steps.push(step("Call mock MCP server with access token", "pass", `HTTP ${mcpResult.status}`));
  } else {
    steps.push(
      step(
        "Call mock MCP server with access token",
        mcpResult.status === 401 ? "fail" : "warn",
        `HTTP ${mcpResult.status}`,
        mcpResult.body.slice(0, 200),
      ),
    );
  }

  return {
    accessToken,
    authorizationCode,
    authorizationServer: options.authorizationServer,
    authorizeUrl,
    clientId,
    mcpEndpoint: options.mcpEndpoint,
    redirectUri,
    resourceUri: options.resourceUri,
    steps,
    tokenClaims,
    tokenResponse,
  };
}

export function formatTokenProbeReport(report: TokenProbeReport): string {
  const lines = [
    "MCP token probe report",
    "",
    `Authorization server: ${report.authorizationServer}`,
    `MCP endpoint:         ${report.mcpEndpoint}`,
    `Resource URI:         ${report.resourceUri}`,
    `Redirect URI:         ${report.redirectUri}`,
    `Client ID:            ${report.clientId ?? "(unknown)"}`,
    "",
  ];

  if (report.authorizeUrl) {
    lines.push(`Authorize URL:`);
    lines.push(report.authorizeUrl);
    lines.push("");
  }

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
    if (probeStep.detail) {
      lines.push(`   ${probeStep.detail}`);
    }
    if (probeStep.note) {
      lines.push(`   note: ${probeStep.note}`);
    }
    lines.push("");
  }

  if (report.tokenClaims) {
    lines.push("Token claims:");
    lines.push(JSON.stringify(report.tokenClaims, null, 2));
    lines.push("");
  }

  if (report.tokenResponse) {
    lines.push("Token response (redacted access_token):");
    const redacted = { ...report.tokenResponse };
    if (typeof redacted.access_token === "string") {
      redacted.access_token = "<redacted>";
    }
    if (typeof redacted.id_token === "string") {
      redacted.id_token = "<redacted>";
    }
    if (typeof redacted.refresh_token === "string") {
      redacted.refresh_token = "<redacted>";
    }
    lines.push(JSON.stringify(redacted, null, 2));
  }

  return lines.join("\n").trimEnd();
}
