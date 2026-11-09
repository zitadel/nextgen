import { describe, expect, it } from "vitest";

import { DocumentChange, MemoryStore, Policy, ZitadelConfig } from "@/lib/zitadel";

const PASSWORD = ".zitadel/policies/password.json";
const LOCKOUT = ".zitadel/policies/lockout.json";

/** A store holding the password policy, and the configuration read from it. */
async function storeWithPasswordPolicy(): Promise<{ store: MemoryStore; config: ZitadelConfig }> {
  const store = new MemoryStore([{ path: PASSWORD, body: { operation: "password" } }]);
  return { store, config: await ZitadelConfig.loadUnchecked(store) };
}

describe("DocumentChange.created", () => {
  it("is true for a document the change writes anew", async () => {
    const { config } = await storeWithPasswordPolicy();
    const lockout = Policy.create({ path: LOCKOUT, body: { operation: "lockout" } });

    const change = new DocumentChange({
      before: config,
      after: config.with(lockout),
      document: lockout,
    });

    expect(change.created).toBe(true);
  });

  it("is false for a document that was already there", async () => {
    const { config } = await storeWithPasswordPolicy();

    const change = new DocumentChange({
      before: config,
      after: config,
      document: Policy.of({ path: PASSWORD, body: { operation: "password" } }),
    });

    expect(change.created).toBe(false);
  });
});

describe("Change.save", () => {
  it("deletes the file of a removed document", async () => {
    const { store, config } = await storeWithPasswordPolicy();

    await config.policies.remove(PASSWORD).save(store);

    expect(store.get(PASSWORD)).toBeUndefined();
  });

  it("does not count a deleted file among those written", async () => {
    const { store, config } = await storeWithPasswordPolicy();

    const written = await config.policies.remove(PASSWORD).save(store);

    expect(written).toEqual([]);
  });

  it("writes the rest of a change that also removes a file", async () => {
    const { store, config } = await storeWithPasswordPolicy();
    const removed = config.policies.remove(PASSWORD);

    await removed.after.policies
      .put(Policy.create({ path: LOCKOUT, body: { operation: "lockout" } }))
      .save(store);

    expect([store.get(PASSWORD), store.get(LOCKOUT)]).toEqual([
      undefined,
      { operation: "lockout" },
    ]);
  });
});
