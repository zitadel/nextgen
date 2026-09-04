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
 *   GET    /sessions/me           — get current session from opaque cookie
 *   DELETE /sessions/me           — revoke the current session (logout)
 *   POST   /projects/:id/claim/complete — spend a claim challenge (session cookie)
 *   GET    /auth/end-session      — OIDC-style end-session, clears cookies
 *   GET    /.well-known/jwks.json — JWKS for JWT verification (dev convenience)
 *   GET    /auth/keys             — JWKS at the URL sdk-core's JWT verifier
 *                                   derives (`${issuerUrl}/auth/keys`). Mock-only:
 *                                   the OIDC surface is not in api/openapi.
 *
 * Platform routes (mounted via setupPlatformHandlers):
 *   POST   /projects                  — create project
 *   GET    /projects/:id              — fetch project
 *   POST   /projects/:id/claim/init   — mint a claim challenge
 *   GET    /projects/:id/claim/status — poll a claim challenge
 *   POST   /schemas                   — create user schema
 *   GET    /schemas                   — list user schemas
 *   GET    /schemas/:id               — fetch user schema
 *   DELETE /schemas/:id               — delete user schema
 *   POST   /flow_definitions          — create flow definition
 *   GET    /flow_definitions          — list flow definitions
 *   GET    /flow_definitions/:id      — get flow definition
 */
import { randomBytes, randomUUID } from "node:crypto";
import { type Server } from "node:http";

import type { ExchangeHandoff200, GetMySession200 } from "@zitadel/api/generated/model";
import { CompleteClaimBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import express from "express";
import cookieParser from "cookie-parser";
import { createMiddleware } from "@mswjs/http-middleware";

import { applyBranding } from "./branding.js";
import { HandoffError, JWK, verifyHandoffToken } from "./crypto.js";
import { defaultDevBranding } from "./default-dev-branding.js";
import { setupMockHandlers } from "./handlers.js";
import { buildOpenIdConfiguration } from "./openid-configuration.js";
import { completeClaimChallenge, errorBody, setupPlatformHandlers } from "./platform-handlers.js";

const SESSION_TTL_SECONDS = 3600;

// The claiming human's account lives in Zitadel's own platform project (ADR
// 046 §2), so only a session belonging to it may complete a claim. Exported so
// conformance and downstream tests can mint an eligible session.
export const PLATFORM_PROJECT_ID = "platform";

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
 * In-memory session store. Maps opaque session tokens to session data.
 * Mimics the Go server's encrypted opaque tokens without actual encryption.
 */
type StoredSession = GetMySession200;

/**
 * Demo identities with a resolved display name — the shape a schema
 * designating `x-display` produces. Any email not listed here signs in with
 * an identifier-only ref (the shipped default schema designates no display
 * properties), so both branches of the rendering chain stay exercisable.
 */
const DEMO_DISPLAY_NAMES = new Map<string, string>([
  ["ada@example.com", "Ada Lovelace"],
  ["grace@example.com", "Grace Hopper"],
]);
const sessionStore = new Map<string, StoredSession>();

/**
 * Generates an opaque session token (random hex, not a JWT).
 * This matches the Go server's behaviour of issuing encrypted opaque tokens.
 */
function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

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

/**
 * Build the configured Express app without binding it to a port.
 *
 * Returning the bare app (rather than a listening {@link Server}) lets a
 * serverless host — e.g. a Vercel function — use it directly as a
 * request handler, while {@link startMockServer} wraps it for the
 * standalone dev server.
 *
 * The issuer is fixed at construction on purpose: the handoff tokens the
 * mock signs (inside the MSW handlers) and the `expectedIss` it later
 * enforces in `/sessions/exchange` must agree, so both read the same
 * value regardless of which host a given request happens to arrive on.
 *
 * **State is not per-app.** The session store, consumed-handoff set, and
 * idempotency cache are module-scoped (see the top of this file), and the
 * branding overlay is likewise module-scoped — `applyBranding` mutates it
 * during construction. So two apps built in the same process **share** all
 * of that state; there is no per-instance isolation. This is intentional
 * for the single-app dev/serverless use cases; tests that need isolation
 * should run in separate workers (as Vitest does) rather than creating
 * multiple apps in one.
 *
 * @param options.issuer - Absolute base URL this mock advertises as its
 *   OIDC issuer (`http://localhost:8080` locally, the preview domain on
 *   Vercel). Embedded in the discovery document and used as the expected
 *   issuer when verifying handoff tokens (the JWKS responses carry only
 *   the key, not the issuer).
 */
export function createMockApp(options: { issuer: string }): express.Express {
  applyBranding(defaultDevBranding);
  const iss = options.issuer;
  const app = express();
  app.use(cookieParser());

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
  app.get(
    "/.well-known/openid-configuration",
    (_req: express.Request, res: express.Response) => {
      res.json(buildOpenIdConfiguration(iss));
    },
  );

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
      const projectId = req.query.project_id;
      if (!projectId || typeof projectId !== "string") {
        res
          .status(400)
          .json(
            errorBody(
              "sess.project_id_missing",
              "The session API currently requires the project_id query parameter to fulfill requests.",
            ),
          );
        return;
      }

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

      const opaqueToken = generateOpaqueToken();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_SECONDS * 1000);
      const sessionId = `sess_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const userId = `user_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      // Store the session data for GET /sessions/me lookups.
      // The `user` ref mirrors the Go server's identity hydration: the mock
      // signs in by email, so the ref's identifier is the email claim.
      // `display` comes from the demo-identity fixture — present for the
      // known demo identities (a schema designating x-display), absent for
      // every other email (the shipped default schema designates none) — so
      // clients can exercise both branches of the display → identifier →
      // user_id rendering chain.
      // A handoff is issued only after a login completes, so the exchanged
      // session carries a verified factor. The contract now defines `active`
      // as "has at least one verified authentication factor", so an empty
      // factor list would contradict the state we report.
      const verifiedFactors = [{ method: "password" as const, verified_at: createdAt.toISOString() }];
      const display = claims.sub ? DEMO_DISPLAY_NAMES.get(claims.sub) : undefined;
      const sessionData: StoredSession = {
        session_id: sessionId,
        project_id: projectId,
        state: "active",
        user_id: userId,
        factors: verifiedFactors,
        assurance_levels: [],
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        user: {
          user_id: userId,
          // identifier_property travels exactly with identifier (ADR 058 §3).
          ...(claims.sub ? { identifier: claims.sub, identifier_property: "email" } : {}),
          ...(display ? { display } : {}),
        },
      };
      sessionStore.set(opaqueToken, sessionData);

      const setCookie = [
        `__nextgen_session=${opaqueToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
        `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      ];
      res.setHeader("Set-Cookie", setCookie);
      const body: ExchangeHandoff200 = {
        session: {
          session_id: sessionId,
          project_id: projectId,
          state: "active",
          user_id: userId,
          factors: verifiedFactors,
          assurance_levels: [],
          created_at: createdAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        session_token: opaqueToken,
      };

      if (idempotencyKey) {
        idempotencyCache.set(idempotencyKey, { body, setCookie });
        setTimeout(() => idempotencyCache.delete(idempotencyKey), IDEMPOTENCY_TTL_MS).unref();
      }

      res.json(body);
    },
  );

  // GET /sessions/me — validate opaque session cookie and return session data.
  // Mirrors the Go server's GetMySession handler.
  app.get("/sessions/me", (req: express.Request, res: express.Response) => {
    const token = (req.cookies as Record<string, string>).__nextgen_session;
    if (!token) {
      res.status(401).json(errorBody("unauthenticated", "no session cookie"));
      return;
    }
    const session = sessionStore.get(token);
    if (!session) {
      res.status(401).json(errorBody("unauthenticated", "invalid or expired session"));
      return;
    }
    // Check expiry
    if (new Date(session.expires_at) < new Date()) {
      sessionStore.delete(token);
      res.status(401).json(errorBody("unauthenticated", "session expired"));
      return;
    }
    res.json(session);
  });

  // DELETE /sessions/me — revoke the current session (logout). Mirrors the
  // Go server's revokeMySession handler and the SDK proxy's logout call.
  app.delete("/sessions/me", (req: express.Request, res: express.Response) => {
    const token = (req.cookies as Record<string, string>).__nextgen_session;
    if (!token) {
      res.status(401).json(errorBody("unauthenticated", "no session cookie"));
      return;
    }
    const session = sessionStore.get(token);
    if (!session) {
      res.status(404).json(errorBody("session_not_found", "session not found"));
      return;
    }
    if (new Date(session.expires_at) < new Date()) {
      sessionStore.delete(token);
      res.status(409).json(errorBody("session_revoked", "session already revoked or expired"));
      return;
    }
    sessionStore.delete(token);
    res.setHeader("Set-Cookie", [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    res.status(204).end();
  });

  // POST /projects/:project_id/claim/complete — the browser leg of the claim
  // dance. A custom Express route (not an MSW handler) because it authenticates
  // with the module-scoped __nextgen_session cookie, exactly like GET
  // /sessions/me. The challenge_id from the body is its browser-safe authorization.
  app.post(
    "/projects/:project_id/claim/complete",
    jsonBodyParser,
    (req: express.Request, res: express.Response) => {
      const token = (req.cookies as Record<string, string>).__nextgen_session;
      const session = token ? sessionStore.get(token) : undefined;
      if (!token || !session || new Date(session.expires_at) < new Date()) {
        res.status(401).json(errorBody("auth.unauthorized", "missing or invalid session token"));
        return;
      }
      // ADR 046 §2: only a platform-project session that is active and carries a
      // verified factor may claim. A customer-project session, an inactive one,
      // or an anonymous pre-login session must never complete a claim.
      const eligible =
        session.project_id === PLATFORM_PROJECT_ID &&
        session.state === "active" &&
        (session.factors?.length ?? 0) > 0;
      if (!eligible) {
        res
          .status(401)
          .json(errorBody("auth.unauthorized", "session is not eligible to claim a project"));
        return;
      }
      const parsed = CompleteClaimBody.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(
            errorBody("invalid_request", "request does not conform to spec", {
              issues: parsed.error.issues,
            }),
          );
        return;
      }
      const result = completeClaimChallenge(parsed.data.challenge_id, req.params.project_id ?? "");
      res.status(result.status).json(result.body);
    },
  );

  app.get("/auth/end-session", (req: express.Request, res: express.Response) => {
    // Clean up session from store when logging out
    const token = (req.cookies as Record<string, string>).__nextgen_session;
    if (token) {
      sessionStore.delete(token);
    }
    res.setHeader("Set-Cookie", [
      `__nextgen_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
      `__nextgen_display=; Path=/; SameSite=Lax; Max-Age=0`,
      `_zflow=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
    ]);
    res.status(204).end();
  });

  app.use(createMiddleware(...setupMockHandlers({ iss }).handlers, ...setupPlatformHandlers()));

  return app;
}

/**
 * Start the standalone dev server: build the app via {@link createMockApp}
 * with a localhost issuer derived from `port`, then bind it.
 */
export function startMockServer(port: number): Server {
  const app = createMockApp({ issuer: `http://localhost:${port}` });
  return app.listen(port, () => {
    console.log(`\napi-mock server listening on http://localhost:${port}`);
    console.log(`  JWKS: http://localhost:${port}/.well-known/jwks.json`);
    console.log(`  Sessions exchange: http://localhost:${port}/sessions/exchange\n`);
  });
}
