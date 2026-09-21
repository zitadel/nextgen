import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AuthResult } from "../../runtime/types";

describe("useAuth composable", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns signed-out state when useState returns unauthenticated", async () => {
    vi.doMock("#imports", () => ({
      useState: vi.fn(() => ({
        value: { isAuthenticated: false, session: null } as AuthResult,
      })),
    }));

    const { useAuth } = await import("../../runtime/composables/useAuth");
    const result = useAuth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns signed-in state when useState returns authenticated", async () => {
    vi.doMock("#imports", () => ({
      useState: vi.fn(() => ({
        value: {
          isAuthenticated: true,
          session: {
            userId: "nuxt-user",
            identifier: "nuxt@example.com",
            identifierProperty: "email",
            display: "NuxtUser",
            token: "tok123",
          },
        } as AuthResult,
      })),
    }));

    const { useAuth } = await import("../../runtime/composables/useAuth");
    const result = useAuth();
    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.userId).toBe("nuxt-user");
      expect(result.session.identifier).toBe("nuxt@example.com");
    }
  });
});
