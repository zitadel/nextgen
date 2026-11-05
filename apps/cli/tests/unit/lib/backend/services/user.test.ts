import { describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/backend/errors";
import { UserService } from "@/lib/backend/services/user";
import { fakeClient } from "@tests/helpers/fake-client";

describe("UserService.exists", () => {
  it("is true for a project that has a user", async () => {
    const userService = new UserService(
      fakeClient({
        queryUsers: async () => ({ users: [{ id: "usr_1" }] }),
      }),
    );

    await expect(userService.exists()).resolves.toBe(true);
  });

  it("is false for a project that has none", async () => {
    const userService = new UserService(
      fakeClient({
        queryUsers: async () => ({ users: [] }),
      }),
    );

    await expect(userService.exists()).resolves.toBe(false);
  });

  it("asks for one user, since that settles it", async () => {
    const queryUsers = vi.fn(async () => ({ users: [] }));
    const userService = new UserService(fakeClient({ queryUsers }));

    await userService.exists();

    expect(queryUsers).toHaveBeenCalledWith({ limit: 1 });
  });
});

describe("UserService.hasIdentityLink", () => {
  it("is true for a user who signs in through a provider", async () => {
    const userService = new UserService(
      fakeClient({
        listUserIdentityLinks: async () => ({ identity_links: [{ id: "lnk_1" }] }),
      }),
    );

    await expect(userService.hasIdentityLink("usr_1")).resolves.toBe(true);
  });

  it("is false for a user who holds none", async () => {
    const userService = new UserService(
      fakeClient({
        listUserIdentityLinks: async () => ({ identity_links: [] }),
      }),
    );

    await expect(userService.hasIdentityLink("usr_1")).resolves.toBe(false);
  });

  it("answers a user who has gone since as holding none, rather than failing", async () => {
    const userService = new UserService(
      fakeClient({
        listUserIdentityLinks: async () => {
          throw new NotFoundError("usr_1 is gone", { status: 404 });
        },
      }),
    );

    await expect(userService.hasIdentityLink("usr_1")).resolves.toBe(false);
  });

  it("raises anything else, so a refused read is not read as no links", async () => {
    const userService = new UserService(
      fakeClient({
        listUserIdentityLinks: async () => {
          throw new ForbiddenError("not allowed", { status: 403 });
        },
      }),
    );

    await expect(userService.hasIdentityLink("usr_1")).rejects.toThrow("not allowed");
  });
});

describe("UserService.credentials", () => {
  const client = (overrides: Record<string, unknown> = {}) =>
    fakeClient({
      getUserPasswordState: async () => ({ set_at: "2026-01-01T00:00:00Z" }),
      listUserPasskeys: async () => ({ passkeys: [] }),
      listUserIdentityLinks: async () => ({ identity_links: [{ id: "lnk_1" }] }),
      ...overrides,
    });

  it("returns the asked credentials the user holds", async () => {
    const userService = new UserService(client());

    await expect(userService.credentials("usr_1", ["password", "passkey", "sso"])).resolves.toEqual(
      new Set(["password", "sso"]),
    );
  });

  it("reads only what is asked", async () => {
    const userService = new UserService(
      client({
        getUserPasswordState: async () => {
          throw new Error("password read");
        },
      }),
    );

    await expect(userService.credentials("usr_1", ["passkey"])).resolves.toEqual(new Set());
  });

  it("answers a user without a password as holding none", async () => {
    const userService = new UserService(client({ getUserPasswordState: async () => ({}) }));

    await expect(userService.credentials("usr_1", ["password"])).resolves.toEqual(new Set());
  });

  it("answers a user who has gone since as holding none", async () => {
    const userService = new UserService(
      client({
        listUserPasskeys: async () => {
          throw new NotFoundError("usr_1 is gone", { status: 404 });
        },
      }),
    );

    await expect(userService.credentials("usr_1", ["passkey"])).resolves.toEqual(new Set());
  });

  it("discards what was read before the user went", async () => {
    const userService = new UserService(
      client({
        listUserPasskeys: async () => ({ passkeys: [{ id: "pk_1" }] }),
        getUserPasswordState: async () => {
          throw new NotFoundError("usr_1 is gone", { status: 404 });
        },
      }),
    );

    await expect(userService.credentials("usr_1", ["passkey", "password"])).resolves.toEqual(
      new Set(),
    );
  });

  it("raises anything else, so a refused read is not read as no credential", async () => {
    const userService = new UserService(
      client({
        listUserPasskeys: async () => {
          throw new ForbiddenError("not allowed", { status: 403 });
        },
      }),
    );

    await expect(userService.credentials("usr_1", ["passkey"])).rejects.toThrow("not allowed");
  });
});
