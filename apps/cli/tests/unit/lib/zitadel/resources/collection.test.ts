import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, Policy, ZitadelConfig } from "@/lib/zitadel";
import {
  aConfig,
  aFile,
  aLoginFlow,
  aPasswordPolicy,
  aStore,
  aUserSchema,
  type ConfigDocuments,
} from "@tests/helpers/config";

/**
 * The password policy's file.
 */
const PASSWORD = `${CONFIG_DIRECTORIES.policies}/password.json`;

/**
 * The lockout policy's file.
 */
const LOCKOUT = `${CONFIG_DIRECTORIES.policies}/lockout.json`;

/**
 * Where setup writes the human-user schema, whose objectType is not its file name.
 */
const HUMAN_USER = `${CONFIG_DIRECTORIES.schemas}/default-human-user.json`;

/**
 * Where the flow in these tests sits, whose name is not its file name.
 */
const LOGIN = `${CONFIG_DIRECTORIES.flows}/login.json`;

/**
 * The editor's pointer at the user schema meta-schema.
 */
const POINTER = "../meta/schema.json";

/**
 * A configuration holding the password policy.
 */
const HOLDING_PASSWORD: ConfigDocuments = {
  policies: { "password.json": aPasswordPolicy() },
};

/**
 * The human-user schema as its file holds it, without the editor's pointer.
 */
const HUMAN_USER_SCHEMA = aUserSchema({ objectType: "human-user" });

/**
 * A configuration holding the human-user schema, with the editor's pointer.
 */
const HOLDING_HUMAN_USER: ConfigDocuments = {
  schemas: { "default-human-user.json": { $schema: POINTER, ...HUMAN_USER_SCHEMA } },
};

/**
 * A body the schema contract refuses, which holds the handle `human-user`.
 */
const REFUSED_SCHEMA = { objectType: "human-user" };

/**
 * The file that holds {@link REFUSED_SCHEMA}.
 */
const REFUSED_SCHEMA_FILE = `${CONFIG_DIRECTORIES.schemas}/refused.json`;

/**
 * A configuration holding {@link REFUSED_SCHEMA} as a broken file.
 */
const HOLDING_REFUSED_SCHEMA: ConfigDocuments = {
  schemas: { "refused.json": REFUSED_SCHEMA },
};

/**
 * A flow body the flow contract refuses, which holds the name `default-login`.
 */
const REFUSED_FLOW = { name: "default-login" };

/**
 * A new policy at the lockout policy's file, not yet written.
 */
const NEW_LOCKOUT = Policy.create(aFile("policies", "lockout.json", aPasswordPolicy()));

describe("Collection.get", () => {
  it("is the document at a path", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const document = config.policies.get(PASSWORD);

    expect(document?.path).toBe(PASSWORD);
  });

  it("is undefined for a path no document of the kind is at", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const document = config.schemas.get(PASSWORD);

    expect(document).toBeUndefined();
  });
});

describe("Collection.findByHandle", () => {
  it("finds the schema whose objectType is the handle, whatever its file is called", () => {
    const config = aConfig(HOLDING_HUMAN_USER);

    const document = config.schemas.findByHandle("human-user");

    expect(document?.path).toBe(HUMAN_USER);
  });

  it("finds the flow whose name is the handle, whatever its file is called", () => {
    const config = aConfig({ flows: { "login.json": aLoginFlow({ name: "default-login" }) } });

    const document = config.flows.findByHandle("default-login");

    expect(document?.path).toBe(LOGIN);
  });

  describe("when no document of the kind holds the handle", () => {
    it("finds nothing", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const document = config.schemas.findByHandle("machine-user");

      expect(document).toBeUndefined();
    });

    it("never takes a document of another kind that carries the handle", () => {
      const config = aConfig({
        schemas: { "default-human-user.json": aUserSchema({ name: "default-login" }) },
      });

      const document = config.flows.findByHandle("default-login");

      expect(document).toBeUndefined();
    });
  });

  describe("with a kind a release does not pin by name", () => {
    it("finds nothing", () => {
      const config = aConfig(HOLDING_PASSWORD);

      const document = config.policies.findByHandle("password");

      expect(document).toBeUndefined();
    });
  });
});

describe("Collection.locate", () => {
  describe("when a broken schema holds the handle in its raw objectType", () => {
    it("is that file rather than a second one", () => {
      const config = aConfig(HOLDING_REFUSED_SCHEMA);

      const path = config.schemas.locate("human-user");

      expect(path).toBe(REFUSED_SCHEMA_FILE);
    });
  });

  describe("when a broken flow holds the handle in its raw name", () => {
    it("is that file rather than a second one", () => {
      const config = aConfig({ flows: { "refused.json": REFUSED_FLOW } });

      const path = config.flows.locate("default-login");

      expect(path).toBe(`${CONFIG_DIRECTORIES.flows}/refused.json`);
    });
  });

  describe("when a broken file of another kind holds the handle", () => {
    it("is the handle's own file name", () => {
      const config = aConfig({ flows: { "refused.json": { objectType: "human-user" } } });

      const path = config.schemas.locate("human-user");

      expect(path).toBe(`${CONFIG_DIRECTORIES.schemas}/human-user.json`);
    });
  });
});

describe("Collection.placeRevision", () => {
  describe("when no file holds the handle", () => {
    it("writes the revision as a new file", () => {
      const config = ZitadelConfig.empty();

      const change = config.schemas.placeRevision("human-user", HUMAN_USER_SCHEMA);

      expect(change.createdPaths).toEqual([`${CONFIG_DIRECTORIES.schemas}/human-user.json`]);
    });

    it("writes a revision the local contract refuses, as the server answered it", async () => {
      const store = aStore();

      await ZitadelConfig.empty().schemas.placeRevision("human-user", REFUSED_SCHEMA).save(store);

      expect(await store.read("schemas")).toEqual([
        { path: `${CONFIG_DIRECTORIES.schemas}/human-user.json`, body: REFUSED_SCHEMA },
      ]);
    });
  });

  describe("when a file holds the handle", () => {
    it("carries the editor's $schema pointer over from it", async () => {
      const store = aStore(HOLDING_HUMAN_USER);

      await aConfig(HOLDING_HUMAN_USER)
        .schemas.placeRevision("human-user", { ...HUMAN_USER_SCHEMA, type: "object" })
        .save(store);

      expect(await store.read("schemas")).toEqual([
        {
          path: HUMAN_USER,
          body: { ...HUMAN_USER_SCHEMA, type: "object", $schema: POINTER },
        },
      ]);
    });

    it("keeps a $schema pointer the revision has of its own", async () => {
      const store = aStore(HOLDING_HUMAN_USER);

      await aConfig(HOLDING_HUMAN_USER)
        .schemas.placeRevision("human-user", {
          $schema: "https://example.test/schema.json",
          ...HUMAN_USER_SCHEMA,
        })
        .save(store);

      expect((await store.read("schemas"))[0]?.body.$schema).toBe(
        "https://example.test/schema.json",
      );
    });

    it("writes nothing when the file already holds exactly the revision", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const change = config.schemas.placeRevision("human-user", HUMAN_USER_SCHEMA);

      expect(change.changed).toBe(false);
    });

    it("counts the replacement as edited, not created", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const change = config.schemas.placeRevision("human-user", {
        ...HUMAN_USER_SCHEMA,
        type: "object",
      });

      expect(change.createdPaths).toEqual([]);
    });

    it("lists the replaced file as changed", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const change = config.schemas.placeRevision("human-user", {
        ...HUMAN_USER_SCHEMA,
        type: "object",
      });

      expect(change.changedPaths).toEqual([HUMAN_USER]);
    });
  });

  describe("when a broken file holds the handle", () => {
    it("replaces it with the revision rather than writing a second file", async () => {
      const store = aStore(HOLDING_REFUSED_SCHEMA);

      await aConfig(HOLDING_REFUSED_SCHEMA)
        .schemas.placeRevision("human-user", HUMAN_USER_SCHEMA)
        .save(store);

      expect(await store.read("schemas")).toEqual([
        { path: REFUSED_SCHEMA_FILE, body: HUMAN_USER_SCHEMA },
      ]);
    });
  });
});

describe("Collection.put", () => {
  it("adds a document the configuration does not have", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.put(NEW_LOCKOUT);

    expect(change.createdPaths).toEqual([LOCKOUT]);
  });

  it("replaces the document at the same path", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.put(
      Policy.create({ path: PASSWORD, body: aPasswordPolicy({ min_length: 16 }) }),
    );

    expect(
      change.after.policies.all.map((policy) => {
        return policy.body;
      }),
    ).toEqual([aPasswordPolicy({ min_length: 16 })]);
  });
});

describe("Collection.remove", () => {
  it("removes the document from the configuration", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.remove(PASSWORD);

    expect(change.after.policies.all).toEqual([]);
  });

  it("deletes the document's file", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.remove(PASSWORD);

    expect(change.removedPaths).toEqual([PASSWORD]);
  });

  it("writes nothing else", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.remove(PASSWORD);

    expect(change.changedPaths).toEqual([]);
  });

  it("changes nothing for a path no document is at", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.remove(LOCKOUT);

    expect(change.changed).toBe(false);
  });

  it("deletes a broken file at the path", () => {
    const config = aConfig(HOLDING_REFUSED_SCHEMA);

    const change = config.schemas.remove(REFUSED_SCHEMA_FILE);

    expect(change.removedPaths).toEqual([REFUSED_SCHEMA_FILE]);
  });

  it("no longer holds the broken file once removed", () => {
    const config = aConfig(HOLDING_REFUSED_SCHEMA);

    const change = config.schemas.remove(REFUSED_SCHEMA_FILE);

    expect(change.after.broken).toEqual([]);
  });

  it("leaves a document of another kind at the path alone", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.schemas.remove(PASSWORD);

    expect(change.after.policies.get(PASSWORD)?.path).toBe(PASSWORD);
  });

  it("deletes nothing for a document that was never written", () => {
    const added = aConfig(HOLDING_PASSWORD).policies.put(NEW_LOCKOUT);

    const change = added.after.policies.remove(LOCKOUT);

    expect(change.changed).toBe(false);
  });

  it("writes a document put back where one was removed, rather than deleting it", () => {
    const removed = aConfig(HOLDING_PASSWORD).policies.remove(PASSWORD);

    const change = removed.after.policies.put(
      Policy.create({ path: PASSWORD, body: aPasswordPolicy() }),
    );

    expect(change.removedPaths).toEqual([]);
  });
});
