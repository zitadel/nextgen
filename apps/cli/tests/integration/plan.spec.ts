import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

usePlatformMock();

/** Adds a field to the committed user schema, as a developer would. */
function addCompanyField(app: ScaffoldedApp): Promise<void> {
  return app.editUserSchema((schema) => {
    schema.properties.company = { type: "string", description: "Company name" };
  });
}

/** Drops the transition the platform requires on a login entry step. */
function breakTheLoginEntryStep(app: ScaffoldedApp): Promise<void> {
  return app.editLoginFlow((flow) => {
    delete flow.steps.find((step) => step.name === "identifier")?.transitions?.user_not_found;
  });
}

describe("plan", () => {
  it("has nothing to reconcile after setup", async () => {
    const app = await aSetUpApp();

    expect(await app.plan()).toReportNothingToDo();
  });

  it("previews without consuming the change it previewed", async () => {
    const app = await aSetUpApp();
    await addCompanyField(app);

    const first = await app.plan();
    const second = await app.plan();

    expect(first.total).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("describes a one-field schema edit as exactly that one field", async () => {
    const app = await aSetUpApp();
    await addCompanyField(app);

    const plan = await app.planRendered();

    expect(plan).toSucceed();
    expect(plan).toSay("company");
    expect(plan).toSay("will publish a new revision");
    expect(plan).toSay("user_schema will be re-pinned to the new revision");
    expect(plan).not.toSay("audience");
    expect(plan).not.toSay("x-audit");
  });

  it("refuses a flow the platform would reject, before apply publishes half of it", async () => {
    const app = await aSetUpApp();
    const published = await app.publishedFlow();
    await breakTheLoginEntryStep(app);

    const plan = await app.planAttempt();

    expect(plan).toFailWith("E_VALIDATION");
    expect(plan).toExplain('entry step for purpose "login" must wire "user_not_found" transition');
    expect(await app.apply()).toFailWith("E_VALIDATION");
    expect(await app.publishedFlow()).toEqual(published);
  });

  it("is clean again once the flow is repaired", async () => {
    const app = await aSetUpApp();
    await breakTheLoginEntryStep(app);
    expect(await app.planAttempt()).toFailWith("E_VALIDATION");

    await app.editLoginFlow((flow) => {
      const entry = flow.steps.find((step) => step.name === "identifier");
      if (entry?.transitions) entry.transitions.user_not_found = { target: "register" };
    });

    expect(await app.plan()).toReportNothingToDo();
  });
});
