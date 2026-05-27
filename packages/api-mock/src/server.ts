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

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    if (origin) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/.well-known/jwks.json", (_req: express.Request, res: express.Response) => {
    res.json({ keys: [JWK] });
  });
  app.get("/auth/keys", (_req: express.Request, res: express.Response) => {
    res.json({ keys: [JWK] });
  });

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
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
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

  app.get("/auth/end-session", (_req: express.Request, res: express.Response) => {
    res.setHeader("Set-Cookie", [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    res.status(204).end();
  });

  app.use(createMiddleware(...setupMockHandlers({ iss }).handlers, ...setupPlatformHandlers()));

  return app.listen(port, () => {
    console.log(`\napi-mock server listening on http://localhost:${port}`);
    console.log(`  JWKS: http://localhost:${port}/.well-known/jwks.json`);
    console.log(`  Sessions exchange: http://localhost:${port}/sessions/exchange\n`);
  });
}
