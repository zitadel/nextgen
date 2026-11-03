import { describe, expect, it } from "vitest";

import { byName, named } from "../../../../src/lib/oclif/names";

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

describe("byName against two names that read the same", () => {
  it("refuses them, rather than leave one of them unreadable", () => {
    expect(() => {
      byName({ "page-token": "a", pageToken: "b" });
    }).toThrow("read as pageToken");
  });
});
