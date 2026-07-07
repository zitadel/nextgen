import { type Server } from "node:http";

import express, { type Express, type Request, type Response } from "express";

import { type McpMockServerConfig, loadConfig } from "./config.js";
import {
  CIMD_CALLBACK_PATH,
  CIMD_METADATA_PATH,
  buildCimdClientMetadata,
  cimdClientIdUrl,
  isCimdCompatibleOrigin,
} from "./cimd.js";
import {
  buildProtectedResourceMetadata,
  buildWwwAuthenticateHeader,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
} from "./protected-resource.js";
import { dispatchMcpBody, isKnownSession } from "./mcp-protocol.js";
import { storeOAuthCallback, takeOAuthCallback } from "./oauth-callback-store.js";
import { validateAccessToken } from "./token-validation.js";

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function sendUnauthorized(res: Response, config: McpMockServerConfig, message: string): void {
  res.setHeader("WWW-Authenticate", buildWwwAuthenticateHeader(config));
  res.status(401).json({
    error: "unauthorized",
    message,
    resource_metadata: protectedResourceMetadataUrl(config),
  });
}

function handleAuthenticatedGetMcp(req: Request, res: Response): void {
  const accept = req.header("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    res.status(405).type("text/plain").send("Use POST for MCP requests or Accept: text/event-stream for SSE");
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.status(200);
  res.flushHeaders();
  res.write(": connected\n\n");

  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30_000);

  req.on("close", () => {
    clearInterval(keepalive);
  });
}

export function createMcpMockApp(config: McpMockServerConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      [
        "Zitadel MCP mock resource server",
        "",
        `MCP endpoint:        POST ${config.resourceUri}`,
        `Protected metadata:  ${protectedResourceMetadataUrl(config)}`,
        `Authorization server: ${config.authorizationServer}`,
        `CIMD metadata:       ${isCimdCompatibleOrigin(config.publicOrigin) ? cimdClientIdUrl(config.publicOrigin) : "(requires MCP_PUBLIC_ORIGIN=https://…)"}`,
        `Token validation:    ${config.introspect ? "Zitadel introspection" : "accept any bearer token"}`,
        "",
        "Unauthenticated MCP requests return HTTP 401 with WWW-Authenticate.",
      ].join("\n"),
    );
  });

  const serveProtectedResourceMetadata = (_req: Request, res: Response): void => {
    res.json(buildProtectedResourceMetadata(config));
  };

  app.get("/.well-known/oauth-protected-resource", serveProtectedResourceMetadata);
  app.get(protectedResourceMetadataPath(config), serveProtectedResourceMetadata);

  app.get(CIMD_METADATA_PATH, (_req, res) => {
    if (!isCimdCompatibleOrigin(config.publicOrigin)) {
      res.status(400).json({
        error: "cimd_unavailable",
        message: "Set MCP_PUBLIC_ORIGIN to an https URL reachable by Zitadel (for example an ngrok tunnel)",
      });
      return;
    }
    res.json(buildCimdClientMetadata(config.publicOrigin));
  });

  app.get(CIMD_CALLBACK_PATH, (req, res) => {
    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    if (error) {
      res.status(400).type("text/plain").send(`Authorization failed: ${error}`);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    if (!code || !state) {
      res.status(400).type("text/plain").send("missing code or state");
      return;
    }

    storeOAuthCallback(state, code);
    res
      .status(200)
      .type("text/plain")
      .send("Authorization complete. You can close this tab and return to the terminal.");
  });

  app.get("/_probe/oauth/callback", (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    if (!state) {
      res.status(400).json({ error: "missing_state" });
      return;
    }
    const code = takeOAuthCallback(state);
    if (!code) {
      res.status(404).json({ error: "callback_pending" });
      return;
    }
    res.json({ code, state });
  });

  const handleMcpRequest = async (req: Request, res: Response): Promise<void> => {
    const token = bearerToken(req);
    if (!token) {
      sendUnauthorized(res, config, "Authorization required");
      return;
    }

    const validation = await validateAccessToken(token, config);
    if (!validation.active) {
      sendUnauthorized(res, config, validation.reason);
      return;
    }

    if (req.method === "GET") {
      handleAuthenticatedGetMcp(req, res);
      return;
    }

    const sessionId = req.header("mcp-session-id");
    const body = req.body as unknown;
    const messages = Array.isArray(body) ? body : [body];
    const isInitialize = messages.some(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "method" in message &&
        (message as { method?: string }).method === "initialize",
    );

    if (!isInitialize) {
      if (!sessionId) {
        res.status(400).json({
          error: "missing_session_id",
          message: "Mcp-Session-Id header is required after initialization",
        });
        return;
      }
      if (!isKnownSession(sessionId)) {
        res.status(404).json({
          error: "session_not_found",
          message: "Unknown or expired MCP session",
        });
        return;
      }
    }

    const outcome = dispatchMcpBody(body);
    if (outcome.sessionId) {
      res.setHeader("Mcp-Session-Id", outcome.sessionId);
    }

    if (outcome.httpStatus === 202) {
      res.status(202).end();
      return;
    }

    if (outcome.body === undefined) {
      res.status(outcome.httpStatus).end();
      return;
    }

    res.status(outcome.httpStatus).json(outcome.body);
  };

  app.get("/mcp", handleMcpRequest);
  app.post("/mcp", handleMcpRequest);

  return app;
}

export function startMcpMockServer(config: McpMockServerConfig = loadConfig()): Server {
  const app = createMcpMockApp(config);
  const server = app.listen(config.port, config.host, () => {
    const metadataUrl = protectedResourceMetadataUrl(config);
    console.log(`[mcp-mock-server] listening on http://${config.host}:${config.port}`);
    console.log(`[mcp-mock-server] MCP endpoint: ${config.resourceUri}`);
    console.log(`[mcp-mock-server] protected resource metadata: ${metadataUrl}`);
    console.log(`[mcp-mock-server] authorization server: ${config.authorizationServer}`);
    console.log(
      `[mcp-mock-server] token validation: ${
        config.introspect ? "Zitadel introspection" : "accept any bearer token"
      }`,
    );
  });
  return server;
}
