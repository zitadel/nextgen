import { describe, expect, it } from "vitest";

import {
  type Change,
  CONFIG_DIRECTORIES,
  DocumentChange,
  FileExistsError,
  Policy,
  UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import {
  aConfig,
  aFile,
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
 * A configuration holding the password policy.
 */
const HOLDING_PASSWORD: ConfigDocuments = {
  policies: { "password.json": aPasswordPolicy() },
};

/**
 * A new policy at the lockout policy's file, not yet written.
 */
const NEW_LOCKOUT = Policy.create(aFile("policies", "lockout.json", aPasswordPolicy()));

/**
 * The user schema's file.
 */
const SCHEMA = `${CONFIG_DIRECTORIES.schemas}/user.json`;

/**
 * A configuration holding a user schema.
 */
const HOLDING_SCHEMA: ConfigDocuments = {
  schemas: { "user.json": aUserSchema() },
};

/**
 * A change that edits the user schema in place, so saving it replaces its file.
 *
 * @param config - A configuration holding the schema.
 * @returns The change.
 */
async function editedSchema(config: ZitadelConfig): Promise<Change> {
  const schema = config.schemas.get(SCHEMA);
  if (schema === undefined) {
    throw new Error("the configuration holds no schema");
  }
  return config.schemas.enable(schema, "passkey");
}

describe("DocumentChange.created", () => {
  it("is true for a document the change writes anew", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = new DocumentChange({
      before: config,
      after: config.with(NEW_LOCKOUT),
      document: NEW_LOCKOUT,
    });

    expect(change.created).toBe(true);
  });

  it("is false for a document that was already there", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = new DocumentChange({
      before: config,
      after: config,
      document: Policy.of(aFile("policies", "password.json", aPasswordPolicy())),
    });

    expect(change.created).toBe(false);
  });
});

describe("Change.save", () => {
  it("deletes the file of a removed document", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);

    await config.policies.remove(PASSWORD).save(store);

    expect(store.get(PASSWORD)).toBeUndefined();
  });

  it("does not count a deleted file among those written", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);

    const written = await config.policies.remove(PASSWORD).save(store);

    expect(written).toEqual([]);
  });

  it("writes the rest of a change that also removes a file", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);
    const removed = config.policies.remove(PASSWORD);

    await removed.after.policies.put(NEW_LOCKOUT).save(store);

    expect([store.get(PASSWORD), store.get(LOCKOUT)]).toEqual([undefined, aPasswordPolicy()]);
  });

  it("refuses a text file that is taken before it replaces a document", async () => {
    const store = aStore(HOLDING_SCHEMA, { "taken.liquid": "mine" });
    const config = await ZitadelConfig.loadUnchecked(store);
    const replaced = (await editedSchema(config)).withText("taken.liquid", "theirs");

    await replaced.save(store).catch(() => {
      return undefined;
    });

    expect(store.get(SCHEMA)).toEqual(aUserSchema());
  });

  it("writes no new document when a new text file is taken", async () => {
    const store = aStore({}, { "taken.liquid": "mine" });
    const config = await ZitadelConfig.loadUnchecked(store);
    const creating = config.policies.put(NEW_LOCKOUT).withText("taken.liquid", "theirs");

    await creating.save(store).catch(() => {
      return undefined;
    });

    expect(store.get(LOCKOUT)).toBeUndefined();
  });

  it("keeps a document in createOnly from being replaced under overwrite", async () => {
    const store = aStore(HOLDING_SCHEMA);
    const config = await ZitadelConfig.loadUnchecked(store);
    const replaced = await editedSchema(config);

    await replaced
      .save(store, {
        overwrite: true,
        createOnly: (document) => {
          return document instanceof UserSchema;
        },
      })
      .catch(() => {
        return undefined;
      });

    expect(store.get(SCHEMA)).toEqual(aUserSchema());
  });

  it("refuses a document in createOnly that is taken, under overwrite", async () => {
    const store = aStore(HOLDING_SCHEMA);
    const config = await ZitadelConfig.loadUnchecked(store);
    const replaced = await editedSchema(config);

    const saving = replaced.save(store, {
      overwrite: true,
      createOnly: (document) => {
        return document instanceof UserSchema;
      },
    });

    await expect(saving).rejects.toBeInstanceOf(FileExistsError);
  });

  it("replaces a document outside createOnly under overwrite", async () => {
    const store = aStore(HOLDING_SCHEMA);
    const config = await ZitadelConfig.loadUnchecked(store);
    const replaced = await editedSchema(config);

    await replaced.save(store, {
      overwrite: true,
      createOnly: () => {
        return false;
      },
    });

    expect(store.get(SCHEMA)).toHaveProperty(["x-auth-methods", "passkey"], { enabled: true });
  });
});
