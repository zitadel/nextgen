/**
 * Standalone HTTP server for the api-mock.
 *
 * Flow routes (POST /flow, GET /flow/:id, POST /flow/:id/submit) and the
 * platform CRUD routes (projects, schemas, flow_definitions, claim) are
 * served by reusing the existing MSW handlers via @mswjs/http-middleware —
 * zero duplication of routing logic.
 *
 * Custom-only routes added on top:
 *   POST   /sessions/exchange     — exchange handoff_token for session cookie
 *   GET    /auth/end-session      — OIDC-style end-session, clears cookies
 *   GET    /.well-known/jwks.json — JWKS for JWT verification
 *   GET    /oauth/v2/keys         — alias for JWKS
 *
 * Platform routes (mounted via setupPlatformHandlers):
 *   POST   /projects                  — create project
 *   GET    /projects/:id              — fetch project
 *   POST   /projects/:id/claim/init   — start claim (stays pending until completeMockClaim())
 *   GET    /projects/:id/claim/status — poll claim status
 *   POST   /schemas                   — create user schema
 *   GET    /schemas/:id               — fetch user schema
 *   DELETE /schemas/:id               — delete user schema
 *   POST   /flow_definitions          — create flow definition
 *   GET    /flow_definitions          — list flow definitions
 *   GET    /flow_definitions/:id      — get flow definition
 *   PATCH  /flow_definitions/:id      — update flow definition
 *   DELETE /flow_definitions/:id      — delete flow definition
 */
import { randomUUID } from "node:crypto";
import { type Server } from "node:http";

import express from "express";
import { createMiddleware } from "@mswjs/http-middleware";

import { JWK, signSessionToken, verifyHandoffToken } from "./crypto.js";
import { setupMockHandlers } from "./handlers.js";
import { errorBody, setupPlatformHandlers } from "./platform-handlers.js";

const SESSION_TTL_SECONDS = 3600;

export function startMockServer(port: number): Server {
  const iss = `http://localhost:${port}`;
  const app = express();

  // ─── CORS ──────────────────────────────────────────────────────────────────
  // Reflects the incoming Origin verbatim and allows credentials so that the
  // demo apps (running on different ports) can make credentialed fetch()
  // calls to this server. This is intentionally permissive because this is a
  // LOCAL DEVELOPMENT MOCK ONLY — never deploy this server publicly.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // Vary must be set before the response is cached — it tells any proxy that
    // the response differs per Origin so it cannot serve Origin-A's response
    // to Origin-B's request.
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    if (origin) res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // Note: 'Cookie' is a browser-forbidden header name and is never sent
      // as a JS request header; it does not need to be in Allow-Headers.
      // Cookies are carried automatically via credentials: "include".
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.status(204).end();
      return;
    }
    next();
  });

  // ─── JWKS ──────────────────────────────────────────────────────────────────
  app.get("/.well-known/jwks.json", (_req, res) => {
    res.json({ keys: [JWK] });
  });
  app.get("/oauth/v2/keys", (_req, res) => {
    res.json({ keys: [JWK] });
  });

  // ─── Sessions exchange ─────────────────────────────────────────────────────
  app.post("/sessions/exchange", express.json(), async (req, res) => {
    const { handoff_token } = req.body as { handoff_token?: unknown };
    if (!handoff_token || typeof handoff_token !== "string") {
      res.status(400).json(errorBody("missing_handoff_token", "handoff_token is required and must be a string"));
      return;
    }
    let claims: { sub: string; iss: string };
    try {
      claims = await verifyHandoffToken(handoff_token, { expectedIss: iss });
    } catch {
      res.status(401).json(errorBody("invalid_handoff_token", "handoff token failed verification"));
      return;
    }
    const sessionJwt = await signSessionToken({ sub: claims.sub, email: claims.sub, iss });
    res.setHeader("Set-Cookie", [
      `__nextgen_session=${sessionJwt}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    // Spec: 200 returns `session-with-token-response.yaml` —
    // `{session: <SessionResponse>, session_token}`. The mock synthesises a
    // minimal session_response from the handoff claims: `state` is "active"
    // (we just authenticated), `factors` and `assurance_levels` are empty
    // (the mock has no factor catalogue), and the TTLs come from the
    // session-cookie window so they stay consistent with the JWT exp.
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
    res.json({
      session: {
        session_id: `sess_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        project_id: claims.sub,
        state: "active",
        factors: [],
        assurance_levels: [],
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      session_token: sessionJwt,
    });
  });

  // ─── OIDC-style end-session ──────────────────────────────────────────────
  // What `<zitadel-logout>` calls via the generated `endSession()` client.
  // Clears cookies and returns 204 No Content, matching the OpenAPI contract.
  app.get("/auth/end-session", (_req, res) => {
    res.setHeader("Set-Cookie", [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    res.status(204).end();
  });

  // ─── Flow API + Platform API — reuse MSW handlers, zero duplication ──────
  app.use(
    createMiddleware(
      ...setupMockHandlers({ iss }).handlers,
      ...setupPlatformHandlers(),
    ),
  );

  return app.listen(port, () => {
    console.log(`\napi-mock server listening on http://localhost:${port}`);
    console.log(`  JWKS: http://localhost:${port}/.well-known/jwks.json`);
    console.log(`  Sessions exchange: http://localhost:${port}/sessions/exchange\n`);
  });
}
