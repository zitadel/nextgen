import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, Policy, ZitadelConfig } from "@/lib/zitadel";
import {
  aConfig,
  aFile,
  aLoginFlow,
  aPasswordPolicy,
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

describe("Collection.placeRevision", () => {
  describe("when no file holds the handle", () => {
    it("writes the revision as a new file", () => {
      const config = ZitadelConfig.empty();

      const change = config.schemas.placeRevision("human-user", HUMAN_USER_SCHEMA);

      expect(change.createdPaths).toEqual([`${CONFIG_DIRECTORIES.schemas}/human-user.json`]);
    });
  });

  describe("when a file holds the handle", () => {
    it("carries the editor's $schema pointer over from it", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const change = config.schemas.placeRevision("human-user", {
        ...HUMAN_USER_SCHEMA,
        type: "object",
      });

      expect(change.after.schemas.get(HUMAN_USER)?.body).toEqual({
        ...HUMAN_USER_SCHEMA,
        type: "object",
        $schema: POINTER,
      });
    });

    it("keeps a $schema pointer the revision has of its own", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const change = config.schemas.placeRevision("human-user", {
        $schema: "https://example.test/schema.json",
        ...HUMAN_USER_SCHEMA,
      });

      expect(change.after.schemas.get(HUMAN_USER)?.body.$schema).toBe(
        "https://example.test/schema.json",
      );
    });

    it("writes nothing when the file already holds exactly the revision", () => {
      const config = aConfig(HOLDING_HUMAN_USER);

      const change = config.schemas.placeRevision("human-user", HUMAN_USER_SCHEMA);

      expect(change.changed).toBe(false);
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
