import { describe, expect, it, vi } from "vitest";

import {
  Change,
  CONFIG_DIRECTORIES,
  ConfigError,
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
 * A text file inside `.zitadel/` that is already taken.
 */
const TAKEN = `${CONFIG_DIRECTORIES.branding}/taken.liquid`;

/**
 * A new policy at the password policy's file, not yet written.
 */
const NEW_PASSWORD = Policy.create({ path: PASSWORD, body: aPasswordPolicy({ min_length: 16 }) });

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
    const store = aStore(HOLDING_SCHEMA, { [TAKEN]: "mine" });
    const config = await ZitadelConfig.loadUnchecked(store);
    const replaced = (await editedSchema(config)).withText(TAKEN, "theirs");

    await replaced.save(store).catch(() => {
      return undefined;
    });

    expect(store.get(SCHEMA)).toEqual(aUserSchema());
  });

  it("writes no new document when a new text file is taken", async () => {
    const store = aStore({}, { [TAKEN]: "mine" });
    const config = await ZitadelConfig.loadUnchecked(store);
    const creating = config.policies.put(NEW_LOCKOUT).withText(TAKEN, "theirs");

    await creating.save(store).catch(() => {
      return undefined;
    });

    expect(store.get(LOCKOUT)).toBeUndefined();
  });

  it("writes nothing when one of the paths leads outside .zitadel/", async () => {
    const store = aStore({});
    const config = await ZitadelConfig.loadUnchecked(store);
    const creating = config.policies
      .put(NEW_LOCKOUT)
      .withText(`${CONFIG_DIRECTORIES.branding}/../../escaped.txt`, "x");

    await creating.save(store).catch(() => {
      return undefined;
    });

    expect(store.get(LOCKOUT)).toBeUndefined();
  });

  it("deletes nothing when one of the paths leads outside .zitadel/", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);
    const removing = config.policies
      .remove(PASSWORD)
      .withText(`${CONFIG_DIRECTORIES.branding}/../../escaped.txt`, "x");

    await removing.save(store).catch(() => {
      return undefined;
    });

    expect(store.get(PASSWORD)).toEqual(aPasswordPolicy());
  });

  it("writes nothing when a path to delete is refused", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);
    const inside = `${CONFIG_DIRECTORIES.branding}/kept-out.txt`;
    const removing = config.policies.remove(PASSWORD).withText(inside, "x");
    vi.spyOn(store, "assertWritable").mockImplementation((path: string) => {
      if (path === PASSWORD) {
        throw new ConfigError(`${path} points outside .zitadel/`);
      }
    });

    await removing.save(store).catch(() => {
      return undefined;
    });

    expect(await store.exists(inside)).toBe(false);
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

  it("replaces a file a new document is put over", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);

    await config.policies
      .put(Policy.create({ path: PASSWORD, body: aPasswordPolicy({ min_length: 16 }) }))
      .save(store);

    expect(store.get(PASSWORD)).toEqual(aPasswordPolicy({ min_length: 16 }));
  });

  it("replaces a file whose document was removed earlier in the same edit", async () => {
    const store = aStore(HOLDING_PASSWORD);
    const config = await ZitadelConfig.loadUnchecked(store);

    await config.policies
      .remove(PASSWORD)
      .after.policies.put(
        Policy.create({ path: PASSWORD, body: aPasswordPolicy({ min_length: 16 }) }),
      )
      .save(store);

    expect(store.get(PASSWORD)).toEqual(aPasswordPolicy({ min_length: 16 }));
  });

  it("still refuses a new document at a path that was free when the configuration was read", async () => {
    const store = aStore({});
    const config = await ZitadelConfig.loadUnchecked(store);
    await store.write({ path: PASSWORD, body: aPasswordPolicy() }, "create");

    const saving = config.policies.put(NEW_PASSWORD).save(store);

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

  it("replaces a file a new document is put over under overwrite, though it was never read", async () => {
    const store = aStore({});
    const config = await ZitadelConfig.loadUnchecked(store);
    await store.write({ path: PASSWORD, body: aPasswordPolicy() }, "create");

    await config.policies.put(NEW_PASSWORD).save(store, { overwrite: true });

    expect(store.get(PASSWORD)).toEqual(aPasswordPolicy({ min_length: 16 }));
  });

  it("keeps a new document in createOnly from replacing a file never read, under overwrite", async () => {
    const store = aStore({});
    const config = await ZitadelConfig.loadUnchecked(store);
    await store.write({ path: PASSWORD, body: aPasswordPolicy() }, "create");

    const saving = config.policies.put(NEW_PASSWORD).save(store, {
      overwrite: true,
      createOnly: () => {
        return true;
      },
    });

    await expect(saving).rejects.toBeInstanceOf(FileExistsError);
  });

  it("writes the files it creates before the files it replaces", async () => {
    const store = aStore(HOLDING_SCHEMA);
    const config = await ZitadelConfig.loadUnchecked(store);
    const edited = await editedSchema(config);
    const change = new Change({ before: config, after: edited.after.with(NEW_LOCKOUT) });
    const written: string[] = [];
    const write = store.write.bind(store);
    vi.spyOn(store, "write").mockImplementation(async (file, mode) => {
      written.push(file.path);
      await write(file, mode);
    });

    await change.save(store);

    expect(written).toEqual([LOCKOUT, SCHEMA]);
  });
});

describe("Change.changed", () => {
  it("is true for a change that only writes a file", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.put(NEW_LOCKOUT);

    expect(change.changed).toBe(true);
  });

  it("is true for a change that only removes a file", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = config.policies.remove(PASSWORD);

    expect(change.changed).toBe(true);
  });

  it("is false for a change that writes and removes nothing", () => {
    const config = aConfig(HOLDING_PASSWORD);

    const change = new Change({ before: config, after: config });

    expect(change.changed).toBe(false);
  });
});
