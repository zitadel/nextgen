import { describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../../../src/lib/backend/errors";
import { UserService } from "../../../../../src/lib/backend/services/user";
import { fakeClient } from "../../../../helpers/fake-client";

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
