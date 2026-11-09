import { describe, expect, it } from "vitest";

import { Policy, ZitadelConfig } from "@/lib/zitadel";

const PASSWORD = ".zitadel/policies/password.json";
const LOCKOUT = ".zitadel/policies/lockout.json";

/** A configuration holding the password policy. */
function withPasswordPolicy(): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: [],
    policies: [{ path: PASSWORD, body: { operation: "password" } }],
    branding: [],
  });
}

describe("Collection.get", () => {
  it("is the document at a path", () => {
    expect(withPasswordPolicy().policies.get(PASSWORD)?.path).toBe(PASSWORD);
  });

  it("is undefined for a path no document of the kind is at", () => {
    expect(withPasswordPolicy().schemas.get(PASSWORD)).toBeUndefined();
  });
});

describe("Collection.put", () => {
  it("adds a document the configuration does not have", () => {
    const change = withPasswordPolicy().policies.put(
      Policy.create({ path: LOCKOUT, body: { operation: "lockout" } }),
    );

    expect(change.createdPaths).toEqual([LOCKOUT]);
  });

  it("replaces the document at the same path", () => {
    const change = withPasswordPolicy().policies.put(
      Policy.create({ path: PASSWORD, body: { operation: "password", min_length: 12 } }),
    );

    expect(
      change.after.policies.all.map((policy) => {
        return policy.body;
      }),
    ).toEqual([
      { operation: "password", min_length: 12 },
    ]);
  });
});

describe("Collection.remove", () => {
  it("removes the document from the configuration", () => {
    const change = withPasswordPolicy().policies.remove(PASSWORD);

    expect(change.after.policies.all).toEqual([]);
  });

  it("deletes the document's file", () => {
    const change = withPasswordPolicy().policies.remove(PASSWORD);

    expect(change.removedPaths).toEqual([PASSWORD]);
  });

  it("writes nothing else", () => {
    const change = withPasswordPolicy().policies.remove(PASSWORD);

    expect(change.changedPaths).toEqual([]);
  });

  it("changes nothing for a path no document is at", () => {
    const change = withPasswordPolicy().policies.remove(LOCKOUT);

    expect(change.changed).toBe(false);
  });

  it("leaves a document of another kind at the path alone", () => {
    const change = withPasswordPolicy().schemas.remove(PASSWORD);

    expect(change.after.policies.get(PASSWORD)?.path).toBe(PASSWORD);
  });

  it("deletes nothing for a document that was never written", () => {
    const added = withPasswordPolicy().policies.put(
      Policy.create({ path: LOCKOUT, body: { operation: "lockout" } }),
    );

    const change = added.after.policies.remove(LOCKOUT);

    expect(change.changed).toBe(false);
  });

  it("writes a document put back where one was removed, rather than deleting it", () => {
    const removed = withPasswordPolicy().policies.remove(PASSWORD);

    const change = removed.after.policies.put(
      Policy.create({ path: PASSWORD, body: { operation: "password" } }),
    );

    expect(change.removedPaths).toEqual([]);
  });
});
