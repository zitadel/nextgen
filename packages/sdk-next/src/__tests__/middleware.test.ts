import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { NextRequest } from "next/server";
import { nextgenMiddleware } from "../middleware";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

function makeRequest(url: string, cookie?: string, authorization?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (authorization) headers["authorization"] = authorization;
  return new NextRequest(url, { headers });
}

/**
 * Monotonically increasing key-ID counter. Each test that exercises JWKS
 * lookup receives a unique `kid`, which maps to a unique cache entry in the
 * module-level JWKS cache inside `lib/jwt.ts`. This keeps tests hermetically
 * isolated without requiring a cache-reset export.
 */
let kidCounter = 0;
function nextKid(): string {
  return `next-test-key-${++kidCounter}`;
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

describe("nextgenMiddleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no token passes through with empty x-nextgen-auth-token", async () => {
    const req = makeRequest("http://localhost:3000/");
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
    });

    expect(res.status).not.toBe(302);
    const token =
      res.headers.get("x-nextgen-auth-token") ??
      res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(token).toBe("");
  });

  it("protected route with no token redirects to /login?next=/admin", async () => {
    const req = makeRequest("http://localhost:3000/admin");
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("protected route with valid cookie passes through with token tunnelled", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ sub: "user-123", email: "user@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(302);
    const tunnelledToken = res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(tunnelledToken).toBe(token);
  });

  it("protected route with valid Bearer token passes through", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt({ sub: "user-123", email: "user@example.com", exp }, kid);

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", undefined, `Bearer ${token}`);
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(302);
    const tunnelledToken = res.headers.get("x-middleware-request-x-nextgen-auth-token");
    expect(tunnelledToken).toBe(token);
  });

  it("protected route with invalid token clears cookie and redirects", async () => {
    const kid = nextKid();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt(
      { sub: "user-123", email: "user@example.com", exp },
      kid,
    );
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignatureXXX`;

    vi.stubGlobal("fetch", mockJwks(kid));

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${tamperedToken}`);
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
  });
});
