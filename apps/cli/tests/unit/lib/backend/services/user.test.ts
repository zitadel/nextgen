import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { ForbiddenError } from "@/lib/backend/errors";
import { UserService } from "@/lib/backend/services/user";
import { answering, refusal, testClient } from "@tests/helpers/api-answers";

/** A service on a test client. */
function service(): UserService {
  return new UserService(testClient());
}

/** Answers what a user holds: a password, no passkey and one identity link. */
function answeringCredentials(server: SetupServer): void {
  answering(server, "getUserPasswordState", { set_at: "2026-01-01T00:00:00Z" });
  answering(server, "listUserPasskeys", { passkeys: [] });
  answering(server, "listUserIdentityLinks", { identity_links: [{ id: "lnk_1" }] });
}

describe("UserService.exists", () => {
  it("is true for a project that has a user", async ({ server }) => {
    answering(server, "queryUsers", { users: [{ id: "usr_1" }] });

    await expect(service().exists()).resolves.toBe(true);
  });

  it("is false for a project that has none", async ({ server }) => {
    answering(server, "queryUsers", { users: [] });

    await expect(service().exists()).resolves.toBe(false);
  });

  it("asks for one user, since that settles it", async ({ server }) => {
    const queried = answering(server, "queryUsers", { users: [] });

    await service().exists();

    expect(queried.map(({ body }) => body)).toEqual([{ limit: 1 }]);
  });
});

describe("UserService.hasIdentityLink", () => {
  it("is true for a user who signs in through a provider", async ({ server }) => {
    answering(server, "listUserIdentityLinks", { identity_links: [{ id: "lnk_1" }] });

    await expect(service().hasIdentityLink("usr_1")).resolves.toBe(true);
  });

  it("is false for a user who holds none", async ({ server }) => {
    answering(server, "listUserIdentityLinks", { identity_links: [] });

    await expect(service().hasIdentityLink("usr_1")).resolves.toBe(false);
  });

  it("answers a user who has gone since as holding none, rather than failing", async ({
    server,
  }) => {
    answering(server, "listUserIdentityLinks", refusal(404, "usr.not_found"));

    await expect(service().hasIdentityLink("usr_1")).resolves.toBe(false);
  });

  it("raises anything else, so a refused read is not read as no links", async ({ server }) => {
    answering(server, "listUserIdentityLinks", refusal(403, "usr.permission_denied"));

    expect(await rejectionOf(() => service().hasIdentityLink("usr_1"))).toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("UserService.credentials", () => {
  it("returns the asked credentials the user holds", async ({ server }) => {
    answeringCredentials(server);

    await expect(service().credentials("usr_1", ["password", "passkey", "sso"])).resolves.toEqual(
      new Set(["password", "sso"]),
    );
  });

  it("reads only what is asked", async ({ server }) => {
    answeringCredentials(server);
    answering(server, "getUserPasswordState", refusal(403, "usr.permission_denied"));

    await expect(service().credentials("usr_1", ["passkey"])).resolves.toEqual(new Set());
  });

  it("answers a user without a password as holding none", async ({ server }) => {
    answeringCredentials(server);
    answering(server, "getUserPasswordState", {});

    await expect(service().credentials("usr_1", ["password"])).resolves.toEqual(new Set());
  });

  it("answers a user who has gone since as holding none", async ({ server }) => {
    answeringCredentials(server);
    answering(server, "listUserPasskeys", refusal(404, "usr.not_found"));

    await expect(service().credentials("usr_1", ["passkey"])).resolves.toEqual(new Set());
  });

  it("discards what was read before the user went", async ({ server }) => {
    answeringCredentials(server);
    answering(server, "listUserPasskeys", { passkeys: [{ id: "pk_1" }] });
    answering(server, "getUserPasswordState", refusal(404, "usr.not_found"));

    await expect(service().credentials("usr_1", ["passkey", "password"])).resolves.toEqual(
      new Set(),
    );
  });

  it("raises anything else, so a refused read is not read as no credential", async ({ server }) => {
    answeringCredentials(server);
    answering(server, "listUserPasskeys", refusal(403, "usr.permission_denied"));

    expect(await rejectionOf(() => service().credentials("usr_1", ["passkey"]))).toBeInstanceOf(
      ForbiddenError,
    );
  });
});
