/**
 * Standalone HTTP server for the api-mock.
 *
 * Flow routes (POST /flow, GET /flow/:id, POST /flow/:id/submit) are served
 * by reusing the existing MSW handlers via @mswjs/http-middleware — zero
 * duplication of routing logic.
 *
 * Custom-only routes added on top:
 *   POST   /sessions/exchange     — exchange handoff_token for session cookie
 *   POST   /logout                — clear session cookies
 *   GET    /auth/end-session      — OIDC-style end-session, clears cookies
 *   GET    /.well-known/jwks.json — JWKS for JWT verification
 *   GET    /oauth/v2/keys         — alias for JWKS
 */
import { type Server } from "node:http";

import express from "express";
import { createMiddleware } from "@mswjs/http-middleware";

import { JWK, signSessionToken, verifyHandoffToken } from "./crypto.js";
import { setupMockHandlers } from "./handlers.js";

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
      res.status(400).json({ error: "missing_handoff_token" });
      return;
    }
    let claims: { sub: string; iss: string };
    try {
      claims = await verifyHandoffToken(handoff_token, { expectedIss: iss });
    } catch {
      res.status(401).json({ error: "invalid_handoff_token" });
      return;
    }
    const sessionJwt = await signSessionToken({ sub: claims.sub, email: claims.sub, iss });
    res.setHeader("Set-Cookie", [
      `__nextgen_session=${sessionJwt}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    res.json({ status: "ok" });
  });

  // ─── Logout ────────────────────────────────────────────────────────────────
  const clearSessionCookies = (res: express.Response): void => {
    res.setHeader("Set-Cookie", [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
  };

  app.post("/logout", (_req, res) => {
    clearSessionCookies(res);
    res.json({ status: "ok" });
  });

  // OIDC-style end-session — what `<zitadel-logout>` calls via the generated
  // `endSession()` client. Clears cookies and returns 204 No Content, matching
  // the OpenAPI contract.
  app.get("/auth/end-session", (_req, res) => {
    clearSessionCookies(res);
    res.status(204).end();
  });

  // ─── Flow API — reuse MSW handlers, zero duplication ──────────────────────
  app.use(createMiddleware(...setupMockHandlers({ iss }).handlers));

  return app.listen(port, () => {
    console.log(`\napi-mock server listening on http://localhost:${port}`);
    console.log(`  JWKS: http://localhost:${port}/.well-known/jwks.json`);
    console.log(`  Sessions exchange: http://localhost:${port}/sessions/exchange\n`);
  });
}
