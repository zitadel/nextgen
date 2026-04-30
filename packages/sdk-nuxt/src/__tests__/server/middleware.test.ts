import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { createApp, toWebHandler } from "h3";
import { createNextgenMiddleware } from "../../runtime/server/middleware";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;

/**
 * Monotonically increasing key-ID counter. Each test that exercises JWKS
 * lookup receives a unique `kid`, which maps to a unique cache entry in the
 * module-level JWKS cache inside `lib/jwt.ts`. This keeps tests hermetically
 * isolated without requiring a cache-reset export.
 */
let kidCounter = 0;
function nextKid(): string {
  return `nuxt-test-key-${++kidCounter}`;
}

/**
 * Builds a minimal JWKS response containing only the shared public key,
 * tagged with the given `kid`. Using a per-test `kid` prevents the JWKS
 * cache from serving a stale entry imported by a previous test run.
 */
function mockJwks(kid: string): ReturnType<typeof vi.fn> {
  const jwks = { keys: [{ ...publicKeyJwk, kid, alg: "RS256", use: "sig" }] };
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(jwks), { status: 200 }));
}

function makeJwt(payload: Record<string, unknown>, kid: string): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const signing = `${header}.${body}`;
  const sign = createSign("SHA256");
  sign.update(signing);
  const sig = sign.sign(privateKeyPem);
  return `${signing}.${base64url(sig)}`;
}

function makeWebRequest(url: string, cookie?: string, authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (authorization) headers["authorization"] = authorization;
  return new Request(url, { headers });
}

describe("createNextgenMiddleware (H3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no token sets nextgenAuth to unauthenticated", async () => {
    const app = createApp();
    app.use(
      createNextgenMiddleware({
        issuerUrl: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(makeWebRequest("http://localhost:3000/"));
    expect(res.status).not.toBe(302);
    expect(capturedAuth).toEqual({ isAuthenticated: false, session: null });
  });

  it("protected route with no cookie redirects to /login?next=/admin", async () => {
    const app = createApp();
    app.use(
      createNextgenMiddleware({
        issuerUrl: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(makeWebRequest("http://localhost:3000/admin"));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("protected route with valid token sets nextgenAuth to authenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ sub: "user-nuxt", email: "nuxt@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        issuerUrl: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/admin", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${token}`),
    );
    expect(res.status).not.toBe(302);
    expect((capturedAuth as { isAuthenticated: boolean }).isAuthenticated).toBe(true);
  });

  it("protected route with valid Bearer token sets nextgenAuth to authenticated", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ sub: "user-nuxt", email: "nuxt@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        issuerUrl: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );

    let capturedAuth: unknown = undefined;
    app.use("/admin", (event) => {
      capturedAuth = event.context.nextgenAuth;
      return { ok: true };
    });

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", undefined, `Bearer ${token}`),
    );
    expect(res.status).not.toBe(302);
    expect((capturedAuth as { isAuthenticated: boolean }).isAuthenticated).toBe(true);
  });

  it("protected route with invalid token clears cookie and redirects", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt({ sub: "user-nuxt", email: "nuxt@example.com", exp }, kid);
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsig`;

    vi.stubGlobal("fetch", mockJwks(kid));

    const app = createApp();
    app.use(
      createNextgenMiddleware({
        issuerUrl: "http://localhost:4000",
        protectedRoutes: ["/admin"],
        loginPath: "/login",
      }),
    );
    app.use("/admin", () => ({ ok: true }));

    const handler = toWebHandler(app);
    const res = await handler(
      makeWebRequest("http://localhost:3000/admin", `__nextgen_session=${tamperedToken}`),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });
});
