import { snapshotPlatformStore } from "@zitadel/api-mock/platform";
import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, NOTHING_TO_RECONCILE } from "../helpers/project";

/**
 * `plan` — what the developer is told will happen, before anything happens.
 *
 * The diff rendering itself is unit-tested. What only a spec can show is that
 * the plan agrees with what `setup` and `apply` actually did, and that it
 * refuses a definition the platform would reject rather than letting `apply`
 * discover it halfway through.
 */
usePlatformMock();

describe("plan", () => {
  it("has nothing to reconcile after setup, and reads without writing", async () => {
    const app = await aSetUpApp();
    const stateBefore = await app.readProjectFile(".zitadel/state.json");

    expect(await app.plan()).toMatchObject(NOTHING_TO_RECONCILE);
    // A preview must not move sync state, or the next plan is diffing against
    // a position the developer never applied.
    expect(await app.readProjectFile(".zitadel/state.json")).toBe(stateBefore);
  });

  it("renders a one-field schema edit as exactly that one field", async () => {
    const app = await aSetUpApp();
    await app.editDocument(".zitadel/schemas/default-human-user.json", (schema) => {
      (schema.properties as Record<string, unknown>).company = {
        type: "string",
        description: "Company name",
      };
    });

    const plan = await app.planRaw();
    expect(plan.exitCode).toBe(0);
    const output = `${plan.stdout}\n${plan.stderr}`;

    expect(output).toContain("company");
    expect(output).toContain("will publish a new revision");
    expect(output).toContain("user_schema will be re-pinned to the new revision");
    // Noise guard: fields the server echoes back (`audience` on flows,
    // spelled-out x-* meta-schema defaults) are not changes the developer
    // made, and must never be shown as though they were.
    expect(output).not.toContain("audience");
    expect(output).not.toContain("x-audit");
  });

  it("catches a server-side flow invariant before anything mutates", async () => {
    const app = await aSetUpApp();
    // Drop the login entry step's `user_not_found` transition. The platform
    // rejects this on publish — but in a combined schema+flow edit the schema
    // has already revised by then, so plan has to be the one that refuses.
    await app.editDocument(".zitadel/flows/default-login.json", (flow) => {
      const steps = flow.steps as Array<{ name: string; transitions: Record<string, unknown> }>;
      delete steps.find((step) => step.name === "identifier")?.transitions.user_not_found;
    });
    const before = snapshotPlatformStore();

    const plan = await app.planRaw(["--json"]);
    expect(plan.exitCode).toBe(3);
    const envelope = app.envelopeOf(plan);
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.message).toContain(
      'entry step for purpose "login" must wire "user_not_found" transition',
    );

    // And apply agrees, without having changed anything on the way to failing.
    const apply = await app.apply();
    expect(apply.exitCode).toBe(3);
    expect(snapshotPlatformStore()).toEqual(before);
  });

  it("is clean again once the invariant is restored", async () => {
    const app = await aSetUpApp();
    await app.editDocument(".zitadel/flows/default-login.json", (flow) => {
      const steps = flow.steps as Array<{ name: string; transitions: Record<string, unknown> }>;
      delete steps.find((step) => step.name === "identifier")?.transitions.user_not_found;
    });
    expect((await app.planRaw(["--json"])).exitCode).toBe(3);

    await app.editDocument(".zitadel/flows/default-login.json", (flow) => {
      const steps = flow.steps as Array<{ name: string; transitions: Record<string, unknown> }>;
      const entry = steps.find((step) => step.name === "identifier");
      if (entry) entry.transitions.user_not_found = { target: "register" };
    });

    expect(await app.plan()).toMatchObject(NOTHING_TO_RECONCILE);
  });
});
