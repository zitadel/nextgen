import { describe, expect, it, vi } from "vitest";

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
