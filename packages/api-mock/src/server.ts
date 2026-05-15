/**
 * Standalone HTTP server for the api-mock.
 *
 * Implements the same Flow API contract as the MSW handlers but runs as a
 * real TCP server so demo apps (`demo-next`, `demo-nuxt`) can point their
 * `NEXTGEN_ISSUER_URL` here without a service worker.
 *
 * Per-session isolation is implemented via a `_zflow` HttpOnly cookie that
 * carries a session ID. Each session ID maps to its own xstate actor so
 * multiple browser tabs don't interfere with each other.
 *
 * Endpoints:
 *   POST   /flow                  — start a new flow
 *   GET    /flow/:id              — get current step (page reload)
 *   POST   /flow/:id/submit       — advance the flow
 *   POST   /sessions/exchange     — exchange handoff_token for session cookie
 *   POST   /logout                — clear session cookies
 *   GET    /.well-known/jwks.json — JWKS for JWT verification
 *   GET    /oauth/v2/keys         — alias for JWKS
 *   OPTIONS *                     — CORS preflight
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { CreateFlow201 } from "@zitadel-nextgen/api/generated/model";

import { JWK, signHandoffToken, signSessionToken, verifyHandoffToken } from "./crypto.js";
import {
  doneStep,
  identifierStep,
  passwordStep,
  registerStep,
  ssoRedirectStep,
} from "./fixtures/login.js";
import { startFlowActor, type FlowActor, type FlowStepName } from "./flow-machine.js";

// ─── Session store ────────────────────────────────────────────────────────────

const sessions = new Map<string, FlowActor>();

function createSession(): { id: string; actor: FlowActor } {
  const id = randomUUID();
  const actor = startFlowActor();
  sessions.set(id, actor);
  return { id, actor };
}

function getSession(id: string): FlowActor | undefined {
  return sessions.get(id);
}

function deleteSession(id: string): void {
  sessions.delete(id);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    };
  }
  return { "Access-Control-Allow-Origin": "*" };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string | string[]>,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    ...corsHeaders(req),
    ...extraHeaders,
  });
  res.end(data);
}

// ─── Flow response builder ────────────────────────────────────────────────────

function actorToResponse(actor: FlowActor, sessionId: string, iss: string): CreateFlow201 {
  const snapshot = actor.getSnapshot();
  const capturedFields = snapshot.context.capturedFields as Record<string, string>;
  const email = capturedFields["email"] ?? "user@example.com";
  const input = { flowId: sessionId, sessionToken: snapshot.context.sessionToken };
  const step = snapshot.value as FlowStepName | "idle";

  switch (step) {
    case "register":
      return registerStep(input);
    case "password":
      return passwordStep(input);
    case "sso-redirect":
      return ssoRedirectStep(input);
    case "done": {
      const response = doneStep(input);
      // Overwrite with a real signed handoff token
      response.handoff_token = signHandoffToken({ sub: email, iss });
      response.handoff_token_expires_at = new Date(Date.now() + 60_000).toISOString();
      return response;
    }
    default:
      return identifierStep(input);
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handlePostFlow(
  req: IncomingMessage,
  res: ServerResponse,
  iss: string,
): Promise<void> {
  const raw = await readBody(req);
  const body = raw ? (JSON.parse(raw) as { purpose?: string }) : {};
  const { id, actor } = createSession();
  actor.send({ type: "RESET" });
  actor.send({ type: "START", purpose: (body.purpose ?? "login") as never });
  const response = actorToResponse(actor, id, iss);
  const cookie = `_zflow=${encodeURIComponent(id)}; HttpOnly; Path=/; SameSite=Lax`;
  sendJson(res, req, 201, response, { "Set-Cookie": cookie });
}

async function handleGetFlow(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  iss: string,
): Promise<void> {
  const actor = getSession(sessionId);
  if (!actor) {
    sendJson(res, req, 404, { error: "session_not_found" });
    return;
  }
  sendJson(res, req, 200, actorToResponse(actor, sessionId, iss));
}

async function handleSubmitFlow(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  iss: string,
): Promise<void> {
  const actor = getSession(sessionId);
  if (!actor) {
    sendJson(res, req, 404, { error: "session_not_found" });
    return;
  }
  const raw = await readBody(req);
  const body = raw
    ? (JSON.parse(raw) as {
        action?: string;
        fields?: Record<string, string>;
        sso_provider_id?: string;
      })
    : {};
  actor.send({
    type: "SUBMIT",
    action: body.action ?? "submit",
    fields: body.fields ?? {},
    sso_provider_id: body.sso_provider_id ?? null,
  });
  sendJson(res, req, 200, actorToResponse(actor, sessionId, iss));
}

async function handleSessionsExchange(
  req: IncomingMessage,
  res: ServerResponse,
  iss: string,
): Promise<void> {
  const raw = await readBody(req);
  const body = raw ? (JSON.parse(raw) as { handoff_token?: string }) : {};
  if (!body.handoff_token) {
    sendJson(res, req, 400, { error: "missing_handoff_token" });
    return;
  }
  let claims: { sub: string; iss: string };
  try {
    claims = verifyHandoffToken(body.handoff_token);
  } catch {
    sendJson(res, req, 401, { error: "invalid_handoff_token" });
    return;
  }
  const sessionJwt = signSessionToken({ sub: claims.sub, email: claims.sub, iss });
  const sessionCookie = `__nextgen_session=${sessionJwt}; HttpOnly; Path=/; SameSite=Lax`;
  const clearZflow = `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": [sessionCookie, clearZflow],
    ...corsHeaders(req),
  });
  res.end(JSON.stringify({ status: "ok" }));
}

function handleLogout(req: IncomingMessage, res: ServerResponse, sessionId: string | null): void {
  if (sessionId) deleteSession(sessionId);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ],
    ...corsHeaders(req),
  });
  res.end(JSON.stringify({ status: "ok" }));
}

// ─── Server ───────────────────────────────────────────────────────────────────

const JWKS_PATHS = new Set(["/.well-known/jwks.json", "/oauth/v2/keys"]);

export function startMockServer(port: number): void {
  const server = createServer(async (req, res) => {
    const iss = `http://localhost:${port}`;
    const url = new URL(req.url ?? "/", iss);
    const { pathname } = url;
    const method = req.method ?? "GET";

    console.log(`  --> ${method} ${pathname}`);

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        ...corsHeaders(req),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Cookie",
      });
      res.end();
      return;
    }

    // JWKS
    if (JWKS_PATHS.has(pathname) && method === "GET") {
      sendJson(res, req, 200, { keys: [JWK] });
      return;
    }

    const cookies = parseCookies(req);
    const zflowId = cookies["_zflow"] ?? null;

    // POST /flow
    if (pathname === "/flow" && method === "POST") {
      await handlePostFlow(req, res, iss);
      return;
    }

    // GET /flow/:id
    const flowGetMatch = /^\/flow\/([^/]+)$/.exec(pathname);
    if (flowGetMatch?.[1] && method === "GET") {
      const sessionId = zflowId ?? flowGetMatch[1];
      await handleGetFlow(req, res, sessionId, iss);
      return;
    }

    // POST /flow/:id/submit
    const flowSubmitMatch = /^\/flow\/([^/]+)\/submit$/.exec(pathname);
    if (flowSubmitMatch?.[1] && method === "POST") {
      const sessionId = zflowId ?? flowSubmitMatch[1];
      await handleSubmitFlow(req, res, sessionId, iss);
      return;
    }

    // POST /sessions/exchange
    if (pathname === "/sessions/exchange" && method === "POST") {
      await handleSessionsExchange(req, res, iss);
      return;
    }

    // POST /logout
    if (pathname === "/logout" && method === "POST") {
      handleLogout(req, res, zflowId);
      return;
    }

    sendJson(res, req, 404, { error: "not_found" });
  });

  server.listen(port, () => {
    console.log(`\napi-mock server listening on http://localhost:${port}`);
    console.log(`  JWKS: http://localhost:${port}/.well-known/jwks.json`);
    console.log(`  Sessions exchange: http://localhost:${port}/sessions/exchange\n`);
  });
}
