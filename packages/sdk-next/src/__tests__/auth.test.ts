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

  it("returns unauthenticated when x-nextgen-auth-status header is absent", async () => {
    const { auth } = await import("../auth");
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns unauthenticated when x-nextgen-auth-status is signed-out", async () => {
    mockHeadersMap.set("x-nextgen-auth-status", "signed-out");
    const { auth } = await import("../auth");
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns authenticated session for signed-in status with valid payload", async () => {
    const token = makeFakeJwt({
      sub: "user-abc",
      email: "alice@example.com",
      name: "Alice",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set("x-nextgen-auth-status", "signed-in");
    mockHeadersMap.set("x-nextgen-auth-token", token);
    const { auth } = await import("../auth");
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

  it("returns unauthenticated when token is malformed", async () => {
    mockHeadersMap.set("x-nextgen-auth-status", "signed-in");
    mockHeadersMap.set("x-nextgen-auth-token", "not.a.valid.jwt.at.all.extra");
    const { auth } = await import("../auth");
    const result = await auth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns null email and name when payload missing those fields", async () => {
    const token = makeFakeJwt({
      sub: "user-xyz",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockHeadersMap.set("x-nextgen-auth-status", "signed-in");
    mockHeadersMap.set("x-nextgen-auth-token", token);
    const { auth } = await import("../auth");
    const result = await auth();
    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.email).toBeNull();
      expect(result.session.name).toBeNull();
    }
  });
});
