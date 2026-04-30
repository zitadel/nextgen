import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { createApp, toWebHandler, getCookie } from "h3";
import { createNextgenMiddleware } from "../../runtime/server/middleware";

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

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyJwk = publicKey.export({ type: "spki", format: "jwk" }) as Record<string, unknown>;
const testKid = "nuxt-test-key-1";

const jwksResponse = {
  keys: [{ ...publicKeyJwk, kid: testKid, alg: "RS256", use: "sig" }],
};

function makeWebRequest(url: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  return new Request(url, { headers });
}

describe("createNextgenMiddleware (H3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("public route with no cookie sets nextgenAuth to unauthenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(
      { sub: "user-nuxt", email: "nuxt@example.com", exp },
      privateKeyPem,
      testKid,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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

  it("protected route with invalid token clears cookie and redirects", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const validToken = makeJwt(
      { sub: "user-nuxt", email: "nuxt@example.com", exp },
      privateKeyPem,
      testKid,
    );
    const parts = validToken.split(".");
    const tamperedToken = `${parts[0]}.${parts[1]}.invalidsig`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(jwksResponse), { status: 200 })),
    );

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
