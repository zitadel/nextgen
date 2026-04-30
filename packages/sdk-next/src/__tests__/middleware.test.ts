import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { NextRequest } from "next/server";
import { nextgenMiddleware } from "../middleware";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(payload: Record<string, unknown>, privateKeyPem: string, kid: string): string {
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

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;
const testKid = "test-key-1";

const jwksResponse = {
  keys: [{ ...publicKeyJwk, kid: testKid, alg: "RS256", use: "sig" }],
};

describe("nextgenMiddleware", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no token passes through without x-nextgen-auth-token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      { sub: "user-123", email: "user@example.com", exp },
      privateKeyPem,
      testKid,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

    const req = makeRequest("http://localhost:3000/admin", `__nextgen_session=${token}`);
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(307);
    const overrideHeaders = res.headers.get("x-middleware-override-headers") ?? "";
    expect(overrideHeaders).toContain("x-nextgen-auth-token");
  });

  it("protected route with valid Bearer token passes through", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      { sub: "user-123", email: "user@example.com", exp },
      privateKeyPem,
      testKid,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

    const req = makeRequest("http://localhost:3000/admin", undefined, `Bearer ${token}`);
    const res = await nextgenMiddleware(req, {
      issuerUrl: "http://localhost:4000",
      protectedRoutes: ["/admin"],
      loginPath: "/login",
    });

    expect(res.status).not.toBe(307);
    const overrideHeaders = res.headers.get("x-middleware-override-headers") ?? "";
    expect(overrideHeaders).toContain("x-nextgen-auth-token");
  });

  it("protected route with invalid token clears cookie and redirects", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt(
      { sub: "user-123", email: "user@example.com", exp },
      privateKeyPem,
      testKid,
    );
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignatureXXX`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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
