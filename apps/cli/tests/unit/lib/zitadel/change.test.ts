import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, DocumentChange, Policy, ZitadelConfig } from "@/lib/zitadel";
import {
  aConfig,
  aFile,
  aPasswordPolicy,
  aStore,
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
});
