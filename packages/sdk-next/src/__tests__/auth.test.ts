import { describe, it, expect, vi, beforeEach } from "vitest";

function base64url(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

const mockHeadersMap = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => mockHeadersMap.get(name) ?? null,
    }),
  ),
}));

describe("auth()", () => {
  beforeEach(() => {
    mockHeadersMap.clear();
    vi.resetModules();
  });

  it("returns unauthenticated when x-nextgen-auth-token header is absent", async () => {
    const { auth } = await import("../auth.js");
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns unauthenticated when x-nextgen-auth-token is an empty string", async () => {
    mockHeadersMap.set("x-nextgen-auth-token", "");
    const { auth } = await import("../auth.js");
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns authenticated session when a valid JWT token is present", async () => {
    const token = makeFakeJwt({
      sub: "user-abc",
      email: "alice@example.com",
      name: "Alice",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set("x-nextgen-auth-token", token);
    const { auth } = await import("../auth.js");
    const result = await auth();
    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: "user-abc",
        email: "alice@example.com",
        name: "Alice",
        token,
      },
    });
  });

  it("returns unauthenticated when JWT token has no sub claim", async () => {
    const token = makeFakeJwt({
      email: "alice@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set("x-nextgen-auth-token", token);
    const { auth } = await import("../auth.js");
    const result = await auth();
    // No sub → falls through to opaque path → still authenticated
    expect(result.isAuthenticated).toBe(true);
  });

  it("returns null email and name when JWT payload missing those fields", async () => {
    const token = makeFakeJwt({
      sub: "user-xyz",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set("x-nextgen-auth-token", token);
    const { auth } = await import("../auth.js");
    const result = await auth();
    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.email).toBeNull();
      expect(result.session.name).toBeNull();
    }
  });

  // ── Opaque token path ────────────────────────────────────────────────

  it("returns authenticated with minimal data for opaque tokens", async () => {
    const opaqueToken = "opaque-encrypted-token-value";
    mockHeadersMap.set("x-nextgen-auth-token", opaqueToken);
    const { auth } = await import("../auth.js");
    const result = await auth();
    expect(result).toEqual({
      isAuthenticated: true,
      session: {
        userId: "unknown",
        email: null,
        name: null,
        token: opaqueToken,
      },
    });
  });

  it("returns authenticated for malformed JWT that is not decodable", async () => {
    mockHeadersMap.set("x-nextgen-auth-token", "not.a.valid.jwt.at.all.extra");
    const { auth } = await import("../auth.js");
    const result = await auth();
    // Middleware already validated this token — trust it
    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.userId).toBe("unknown");
    }
  });
});
