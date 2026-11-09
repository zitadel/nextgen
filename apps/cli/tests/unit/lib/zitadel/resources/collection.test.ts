import { describe, expect, it } from "vitest";

import { MemoryStore, Policy, ZitadelConfig } from "@/lib/zitadel";

const PASSWORD = ".zitadel/policies/password.json";
const LOCKOUT = ".zitadel/policies/lockout.json";

/** Where setup writes the human-user schema, whose objectType is not its file name. */
const HUMAN_USER = ".zitadel/schemas/default-human-user.json";

/** Where the flow in these tests sits, whose name is not its file name. */
const LOGIN = ".zitadel/flows/login.json";

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

describe("Collection.holding", () => {
  it("finds the schema whose objectType is the handle, whatever its file is called", async () => {
    const config = await ZitadelConfig.loadUnchecked(
      new MemoryStore([{ path: HUMAN_USER, body: { objectType: "human-user" } }]),
    );

    const document = config.schemas.findByHandle("human-user");

    expect(document?.path).toBe(HUMAN_USER);
  });

  it("finds the flow whose name is the handle, whatever its file is called", async () => {
    const config = await ZitadelConfig.loadUnchecked(
      new MemoryStore([{ path: LOGIN, body: { name: "default-login" } }]),
    );

    const document = config.flows.findByHandle("default-login");

    expect(document?.path).toBe(LOGIN);
  });

  describe("when no document of the kind holds the handle", () => {
    it("finds nothing", async () => {
      const config = await ZitadelConfig.loadUnchecked(
        new MemoryStore([{ path: HUMAN_USER, body: { objectType: "human-user" } }]),
      );

      const document = config.schemas.findByHandle("machine-user");

      expect(document).toBeUndefined();
    });

    it("never takes a document of another kind that carries the handle", async () => {
      const config = await ZitadelConfig.loadUnchecked(
        new MemoryStore([{ path: HUMAN_USER, body: { name: "default-login" } }]),
      );

      const document = config.flows.findByHandle("default-login");

      expect(document).toBeUndefined();
    });
  });

  describe("with a kind a release does not pin by name", () => {
    it("finds nothing", () => {
      const config = withPasswordPolicy();

      const document = config.policies.findByHandle("password");

      expect(document).toBeUndefined();
    });
  });
});

describe("Collection.placeRevision", () => {
  describe("when no file holds the handle", () => {
    it("writes the revision as a new file", () => {
      const config = ZitadelConfig.empty();

      const change = config.schemas.placeRevision("human-user", { objectType: "human-user" });

      expect(change.createdPaths).toEqual([".zitadel/schemas/human-user.json"]);
    });
  });

  describe("when a file holds the handle", () => {
    it("carries the editor's $schema pointer over from it", async () => {
      const config = await ZitadelConfig.loadUnchecked(
        new MemoryStore([
          { path: HUMAN_USER, body: { $schema: "../meta/schema.json", objectType: "human-user" } },
        ]),
      );

      const change = config.schemas.placeRevision("human-user", {
        objectType: "human-user",
        type: "object",
      });

      expect(change.after.schemas.get(HUMAN_USER)?.body).toEqual({
        objectType: "human-user",
        type: "object",
        $schema: "../meta/schema.json",
      });
    });

    it("keeps a $schema pointer the revision has of its own", async () => {
      const config = await ZitadelConfig.loadUnchecked(
        new MemoryStore([
          { path: HUMAN_USER, body: { $schema: "../meta/schema.json", objectType: "human-user" } },
        ]),
      );

      const change = config.schemas.placeRevision("human-user", {
        $schema: "https://example.test/schema.json",
        objectType: "human-user",
      });

      expect(change.after.schemas.get(HUMAN_USER)?.body.$schema).toBe(
        "https://example.test/schema.json",
      );
    });

    it("writes nothing when the file already holds exactly the revision", async () => {
      const config = await ZitadelConfig.loadUnchecked(
        new MemoryStore([
          { path: HUMAN_USER, body: { $schema: "../meta/schema.json", objectType: "human-user" } },
        ]),
      );

      const change = config.schemas.placeRevision("human-user", { objectType: "human-user" });

      expect(change.changed).toBe(false);
    });
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
    ).toEqual([{ operation: "password", min_length: 12 }]);
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
