import { describe, expect, it } from "vitest";

import { byName, named } from "@/lib/oclif/names";

describe("named", () => {
  it.each([
    ["client-id", "clientId"],
    ["release_id", "releaseId"],
    ["sso-client-id", "ssoClientId"],
    ["password-min-length", "passwordMinLength"],
    ["no-open", "noOpen"],
    ["json", "json"],
    ["page-token", "pageToken"],
  ])("spells %j as %j", (name, expected) => {
    expect(named(name)).toBe(expected);
  });
});

describe("byName", () => {
  it("keys every value as code reads it, keeping the values as they are", () => {
    expect(byName({ "client-id": "abc", "dry-run": true, port: 8080 })).toEqual({
      clientId: "abc",
      dryRun: true,
      port: 8080,
    });
  });
});

describe("two names that read the same", () => {
  // Nothing a command declares may collide, which
  // `tests/unit/lib/oclif/names-declared.test.ts` fails on. Here is what it
  // would cost if one did: the second value is the one left readable.
  it("leaves only the last of them readable", () => {
    expect(byName({ "page-token": "a", pageToken: "b" })).toEqual({ pageToken: "b" });
  });
});
