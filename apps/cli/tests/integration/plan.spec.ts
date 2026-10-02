import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

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
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still previews the pending edit", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        platform.isNotZitadel();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });
    });

    describe("that is down", () => {
      it("still previews the pending edit", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        platform.isUnavailable();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("has nothing to reconcile after setup", async () => {
        const app = await aSetUpApp();

        const result = await app.plan();

        expect(result).toReportNothingToDo();
      });

      it("reports an edit as pending", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
      });

      it("previews without consuming the change it previewed", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);
        const first = await app.plan();

        const second = await app.plan();

        expect(second).toEqual(first);
      });

      it("refuses a flow the platform would reject", async () => {
        const app = await aSetUpApp();
        await breakTheLoginEntryStep(app);

        const result = await app.planAttempt();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain(
          'entry step for purpose "login" must wire "user_not_found" transition',
        );
      });

      it("refuses it before apply can publish half of it", async () => {
        const app = await aSetUpApp();
        const published = await app.publishedFlow();
        await breakTheLoginEntryStep(app);

        await app.planAttempt();

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

    describe("rendered for a terminal", () => {
      it("names the edited field", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.planRendered();

        expect(result).toPrint("company");
      });
      it("says a new revision will be published and the flow re-pinned", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.planRendered();

        expect(result).toPrint("will publish a new revision");
        expect(result).toPrint("user_schema will be re-pinned to the new revision");
      });
      it("does not report fields the server echoes back as changes", async () => {
        const app = await aSetUpApp();
        await addCompanyField(app);

        const result = await app.planRendered();

        expect(result).not.toPrint("audience");
        expect(result).not.toPrint("x-audit");
      });
    });
  });
});
