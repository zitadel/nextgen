import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** A flow whose captcha gate reads its secret from the environment. */
const FLOW_NEEDING_A_CAPTCHA_SECRET = {
  name: "default",
  status: "active",
  user_schema:
    "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: [],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
      gates: {
        captcha: {
          kind: "captcha",
          provider: "altcha",
          config: { client_secret_env: "MY_CAPTCHA_SECRET" },
        },
      },
    },
    { name: "done", complete: "show" },
  ],
};

/** Adds a field and uses it in the register step, the combined-edit case. */
async function addCompanyFieldAndUseIt(app: ScaffoldedApp): Promise<void> {
  await app.editUserSchema((schema) => {
    schema.properties.company = { type: "string" };
  });
  await app.editLoginFlow((flow) => {
    flow.steps.find((step) => step.name === "register")?.fields?.push("company");
  });
}

describe("apply", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);
        platform.isNotZitadel();

        const result = await app.apply();

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);
        platform.isUnavailable();

        const result = await app.apply();

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);
        platform.refusesConnections();

        const result = await app.apply();

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("reports a project that already matches as synced", async () => {
        const app = await aSetUpApp();

        const result = await app.apply();

        expect(app.envelopeOf<{ synced: boolean }>(result).data.synced).toBe(true);
      });

      it("publishes a new schema revision for an edited schema", async () => {
        const app = await aSetUpApp();
        const before = await app.publishedSchema();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        const after = await app.publishedSchema();
        expect(after.id).not.toBe(before.id);
      });

      it("carries the edit into the published schema", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        expect((await app.publishedSchema()).schema.properties).toHaveProperty("company");
      });

      it("moves the published flow onto the new revision in the same run", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        const { id } = await app.publishedSchema();
        expect((await app.publishedFlow()).flow_definition.user_schema).toBe(id);
      });

      it("leaves nothing to reconcile after a combined edit", async () => {
        const app = await aSetUpApp();
        await addCompanyFieldAndUseIt(app);

        expect(await app.apply()).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      it("refuses a flow whose gate needs an environment variable that is not set", async () => {
        const app = await aSetUpApp();
        await app.addFlow("default", FLOW_NEEDING_A_CAPTCHA_SECRET);

        const result = await app.apply();

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("Missing environment variables");
      });

      it("accepts that flow once the variable is set", async () => {
        const app = await aSetUpApp();
        await app.addFlow("default", FLOW_NEEDING_A_CAPTCHA_SECRET);

        const result = await app.run(["apply", "--non-interactive", "--json"], {
          MY_CAPTCHA_SECRET: "hunter2",
        });

        expect(result).toSucceed();
      });
    });

    it("changes nothing on a dry run", async () => {
      const app = await aSetUpApp();
      await addCompanyFieldAndUseIt(app);
      const published = await app.publishedSchema();
      const before = await app.snapshot();

      const result = await app.apply(["--dry-run"]);

      expect(result).toSucceed();
      expect(await app.publishedSchema()).toEqual(published);
      expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
    });
  });
});
