/**
 * Standalone HTTP server for the api-mock.
 *
 * Flow routes (POST /flow, GET /flow/:id, POST /flow/:id/submit) and the
 * platform CRUD routes (projects, schemas, flow_definitions) are served by
 * reusing the existing MSW handlers via @mswjs/http-middleware — zero
 * duplication of routing logic.
 *
 * Custom-only routes added on top:
 *   POST   /sessions/exchange     — exchange handoff_token for session cookie
 *   GET    /auth/end-session      — OIDC-style end-session, clears cookies
 *   GET    /.well-known/jwks.json — JWKS for JWT verification (dev convenience)
 *   GET    /auth/keys             — JWKS, spec-defined endpoint (operation `getKeys`)
 *
 * Platform routes (mounted via setupPlatformHandlers):
 *   POST   /projects                  — create project
 *   GET    /projects/:id              — fetch project
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

import type { ExchangeHandoff200 } from "@zitadel-nextgen/api/generated/model";
import express from "express";
import { createMiddleware } from "@mswjs/http-middleware";

import { applyBranding } from "./branding.js";
import { HandoffError, JWK, signSessionToken, verifyHandoffToken } from "./crypto.js";
import { defaultDevBranding } from "./default-dev-branding.js";
import { setupMockHandlers } from "./handlers.js";
import { errorBody, setupPlatformHandlers } from "./platform-handlers.js";

const SESSION_TTL_SECONDS = 3600;

/**
 * Tracks handoff tokens (by `jti`) we've already consumed so a replay
 * surfaces as 410 Gone. Per the spec a handoff is single-use — a real
 * backend rejects the second exchange.
 *
 * Module-scoped because each process keeps one set; for the dev loop the
 * mock runs for the whole session and we want consumption state to persist
 * across requests. Vitest workers get their own copy via worker isolation.
 */
const consumedHandoffJtis = new Set<string>();

/**
 * Cache of completed `/sessions/exchange` responses keyed by the caller's
 * `Idempotency-Key` header. Per `api/openapi/components/parameters/idempotency-key.yaml`,
 * a retry with the same key within the call window returns the cached
 * payload without consuming a fresh handoff token. The TTL matches the
 * 60-second handoff lifetime so stale keys don't pile up.
 */
type IdempotencyCacheEntry = {
  body: ExchangeHandoff200;
  setCookie: string[];
};
const IDEMPOTENCY_TTL_MS = 60_000;
const idempotencyCache = new Map<string, IdempotencyCacheEntry>();

export function startMockServer(port: number): Server {
  applyBranding(defaultDevBranding);
  const iss = `http://localhost:${port}`;
  const app = express();

  // ─── CORS ──────────────────────────────────────────────────────────────────
  // Reflects the incoming Origin verbatim and allows credentials so that the
  // demo apps (running on different ports) can make credentialed fetch()
  // calls to this server. This is intentionally permissive because this is a
  // LOCAL DEVELOPMENT MOCK ONLY — never deploy this server publicly.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.headers.origin;
    // Vary must be set before the response is cached — it tells any proxy that
    // the response differs per Origin so it cannot serve Origin-A's response
    // to Origin-B's request.
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    if (origin) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      // Includes PUT/PATCH/DELETE so cross-origin preflights for the
      // /flow_definitions/:id (PATCH, DELETE) and /schemas/:id (DELETE)
      // routes succeed. Without these, a browser would block the actual
      // request and the failure would surface as a confusing CORS error.
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      // Note: 'Cookie' is a browser-forbidden header name and is never sent
      // as a JS request header; it does not need to be in Allow-Headers.
      // Cookies are carried automatically via credentials: "include".
      // Idempotency-Key is custom (see /sessions/exchange) — must be listed
      // explicitly or the browser preflight blocks the actual request.
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
      res.status(204).end();
      return;
    }
    next();
  });

  // ─── JWKS ──────────────────────────────────────────────────────────────────
  app.get("/.well-known/jwks.json", (_req: express.Request, res: express.Response) => {
    res.json({ keys: [JWK] });
  });
  app.get("/auth/keys", (_req: express.Request, res: express.Response) => {
    res.json({ keys: [JWK] });
  });

  // ─── Sessions exchange ─────────────────────────────────────────────────────
  //
  // express.json() returns a SyntaxError into Express's default error handler
  // on malformed bodies, which renders an HTML 400. Wrap it in an error
  // middleware that emits our spec-compliant errorBody envelope instead.
  const jsonBodyParser: express.RequestHandler = (req, res, next) => {
    express.json()(req, res, (err) => {
      if (err) {
        res.status(400).json(errorBody("invalid_json", "request body must be valid JSON"));
        return;
      }
      next();
    });
  };
  app.post(
    "/sessions/exchange",
    jsonBodyParser,
    async (req: express.Request, res: express.Response) => {
      // Idempotency-Key short-circuit: if the caller already exchanged with
      // this key inside the cache window, replay the cached body+cookies
      // without consuming a fresh handoff. Pairs with single-use enforcement
      // so retries don't accidentally 410 on a network blip.
      const idempotencyKey = req.header("Idempotency-Key");
      if (idempotencyKey) {
        const cached = idempotencyCache.get(idempotencyKey);
        if (cached) {
          res.setHeader("Set-Cookie", cached.setCookie);
          res.json(cached.body);
          return;
        }
      }

      const { handoff_token } = req.body as { handoff_token?: unknown };
      if (!handoff_token || typeof handoff_token !== "string") {
        res
          .status(400)
          .json(
            errorBody("missing_handoff_token", "handoff_token is required and must be a string"),
          );
        return;
      }
      let claims: { sub: string; iss: string; jti?: string };
      try {
        claims = await verifyHandoffToken(handoff_token, { expectedIss: iss });
      } catch (err) {
        // Spec maps consumed/expired handoff tokens to 410 Gone; every other
        // verification failure (signature, audience, issuer, structure) is 401.
        if (err instanceof HandoffError && err.kind === "expired") {
          res
            .status(410)
            .json(errorBody("handoff_consumed", "handoff token expired or already consumed"));
          return;
        }
        res
          .status(401)
          .json(errorBody("invalid_handoff_token", "handoff token failed verification"));
        return;
      }
      const { jti } = claims;
      if (jti !== undefined && consumedHandoffJtis.has(jti)) {
        res
          .status(410)
          .json(errorBody("handoff_consumed", "handoff token expired or already consumed"));
        return;
      }
      if (jti !== undefined) {
        consumedHandoffJtis.add(jti);
      }

      const sessionJwt = await signSessionToken({ sub: claims.sub, email: claims.sub, iss });
      const setCookie = [
        `__nextgen_session=${sessionJwt}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
        `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      ];
      res.setHeader("Set-Cookie", setCookie);
      // Spec: 200 returns `session-with-token-response.yaml` —
      // `{session: <SessionResponse>, session_token}`. The mock synthesises a
      // minimal session_response from the handoff claims: `state` is "active"
      // (we just authenticated), `factors` is an empty list and
      // `assurance_levels` an empty list (the mock has no factor catalogue),
      // and the TTLs come from the session-cookie window so they stay
      // consistent with the JWT exp.
      //
      // Body is typed against the orval-generated `ExchangeHandoff200` so any
      // future spec change (added required field, renamed key) surfaces here
      // as a typecheck error rather than silent runtime drift.
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
      // `project_id` must satisfy `^[a-zA-Z0-9_-]+$` per the spec. The
      // handoff's `sub` claim is the captured user identifier (typically
      // an email like `alice@example.com`) and would fail that pattern.
      // The mock doesn't thread the real project_id through the flow ↔
      // handoff ↔ exchange chain (it would require plumbing the value
      // into the actor context and the JWT claim), so we emit a stable
      // mock value that's pattern-valid.
      const body: ExchangeHandoff200 = {
        session: {
          session_id: `sess_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          project_id: "proj_mock",
          state: "active",
          factors: {},
          assurance_levels: [],
          created_at: createdAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        session_token: sessionJwt,
      };

      if (idempotencyKey) {
        idempotencyCache.set(idempotencyKey, { body, setCookie });
        setTimeout(() => idempotencyCache.delete(idempotencyKey), IDEMPOTENCY_TTL_MS).unref();
      }

      res.json(body);
    },
  );

  // ─── OIDC-style end-session ──────────────────────────────────────────────
  // What `<zitadel-logout>` calls via the generated `endSession()` client.
  // Clears cookies and returns 204 No Content, matching the OpenAPI contract.
  app.get("/auth/end-session", (_req: express.Request, res: express.Response) => {
    res.setHeader("Set-Cookie", [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    res.status(204).end();
  });

  // ─── Flow API + Platform API — reuse MSW handlers, zero duplication ──────
  app.use(createMiddleware(...setupMockHandlers({ iss }).handlers, ...setupPlatformHandlers()));

  return app.listen(port, () => {
    console.log(`\napi-mock server listening on http://localhost:${port}`);
    console.log(`  JWKS: http://localhost:${port}/.well-known/jwks.json`);
    console.log(`  Sessions exchange: http://localhost:${port}/sessions/exchange\n`);
  });
}
