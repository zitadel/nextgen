import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp } from "../helpers/project";

const platform = usePlatformMock();

const SOCIAL_CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

const SCAFFOLDED_PAGES = ["app/login/page.tsx", "app/register/page.tsx", "app/profile/page.tsx"];

describe("setup", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        const result = await app.setup();

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.isUnavailable();

        const result = await app.setup();

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.refusesConnections();

        const result = await app.setup();

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("scaffolds the project", async () => {
        const app = await anApp();
        const before = await app.snapshot();

        const result = await app.setup();

        expect(result).toSucceed();
        expect((await before.changes()).added).toEqual(expect.arrayContaining(SCAFFOLDED_PAGES));
      });

      it("reports the configuration files it wrote", async () => {
        const app = await anApp();

        const result = await app.setup();

        const { data } = app.envelopeOf<{ files_written: string[] }>(result);
        expect(data.files_written).toContain(".zitadel/schemas/default-human-user.json");
        expect(data.files_written).toContain(".zitadel/flows/default-login.json");
      });

      it("reports each written file once", async () => {
        const app = await anApp();

        const result = await app.setup();

        const { data } = app.envelopeOf<{ files_written: string[] }>(result);
        expect(new Set(data.files_written).size).toBe(data.files_written.length);
      });

      it("registers the schema and the flow with the platform", async () => {
        const app = await anApp();

        expect(await app.setup()).toSucceed();

        expect(await app.publishedSchemas()).toHaveLength(1);
        expect(await app.publishedFlows()).toHaveLength(1);
      });

      it("leaves nothing to reconcile", async () => {
        const app = await anApp();

        expect(await app.setup()).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      it("installs the dependencies it added", async () => {
        const app = await anApp();

        expect(await app.setup([], { install: true })).toSucceed();

        expect(await app.installInvocation()).toEqual({
          cwd: await realpath(app.path),
          args: ["install"],
        });
      });

      it("keeps the package manager's own output off stdout", async () => {
        const app = await anApp();

        const result = await app.setup([], { install: true });

        expect(result.stdout).not.toContain("fake npm stdout");
        expect(result.stderr).toContain("fake npm stdout");
      });

      it("refuses an app below the supported framework version", async () => {
        const app = await anApp({ nextVersion: "^14.2.0" });

        const result = await app.setup();

        expect(result).toFailWith("E_UNSUPPORTED_PROJECT_SHAPE");
        expect(result).toExplain("below the supported floor");
      });

      it("writes nothing to an app it refuses", async () => {
        const app = await anApp({ nextVersion: "^14.2.0" });
        const before = await app.snapshot();

        await app.setup();

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("skips a rerun", async () => {
        const app = await anApp();
        expect(await app.setup()).toSucceed();

        const rerun = await app.setup();

        expect(rerun).toBeSkipped();
      });

      it("leaves the developer's edits in place on a rerun", async () => {
        const app = await anApp();
        expect(await app.setup()).toSucceed();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });

        expect(await app.setup()).toBeSkipped();

        expect((await app.plan()).total).toBeGreaterThan(0);
      });

      it("does not claim to be configured after a failed run", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        expect(await app.setup()).toFail();

        expect(await app.hasBeenConfigured()).toBe(false);
      });

      it("lets a rerun finish what a failed run started", async () => {
        const app = await anApp();
        platform.rejectsSchemaUploads();
        expect(await app.setup()).toFail();
        platform.recovers();

        expect(await app.setup(["--force"])).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      it.each([
        { preset: "passkey-first", entersOn: "passkey-first", method: "passkey" },
        { preset: "password-first", entersOn: "identifier", method: "password" },
      ])("enters the $preset journey on $entersOn", async ({ preset, entersOn }) => {
        const app = await anApp();

        expect(await app.setup(["--preset", preset])).toSucceed();

        const { flow_definition } = await app.publishedFlow();
        expect(flow_definition.purposes).toMatchObject({ login: entersOn, register: "register" });
      });

      it.each([
        { preset: "passkey-first", method: "passkey" },
        { preset: "password-first", method: "password" },
      ])("enables $method for the $preset preset", async ({ preset, method }) => {
        const app = await anApp();

        expect(await app.setup(["--preset", preset])).toSucceed();

        const { schema } = await app.publishedSchema();
        expect(schema["x-auth-methods"]).toMatchObject({ [method]: { enabled: true } });
      });

      it.each(["business", "minimal"])(
        "scaffolds the pages for the %s use case",
        async (useCase) => {
          const app = await anApp();
          const before = await app.snapshot();

          expect(await app.setup(["--use-case", useCase])).toSucceed();

          expect((await before.changes()).added).toEqual(expect.arrayContaining(SCAFFOLDED_PAGES));
        },
      );

      it("registers a social provider asked for during setup", async () => {
        const app = await anApp();

        const result = await app.setupWithSso("google", SOCIAL_CREDENTIALS);

        expect(result).toSucceed();
        expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual(["google"]);
      });

      it("publishes that provider's client id as a readable project variable", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        const published = await app.projectVariables();

        expect(published).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "GOOGLE_CLIENT_ID",
              value: SOCIAL_CREDENTIALS.clientId,
            }),
          ]),
        );
      });

      it("publishes that provider's secret without its value", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        const published = await app.projectVariables();

        const held = published.find((variable) => variable.name === "GOOGLE_CLIENT_SECRET");
        expect(held).toMatchObject({ secret: true });
        expect(held).not.toHaveProperty("value");
      });

      it("commits references to both of that provider's credentials", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        const connection = await app.committed.idpConnection("google");

        expect(connection.oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
        expect(connection.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
      });

      it("keeps that provider's credentials out of every file in the project", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        expect(await app.filesContaining(SOCIAL_CREDENTIALS.secret)).toEqual([]);
        expect(await app.filesContaining(SOCIAL_CREDENTIALS.clientId)).toEqual([]);
      });

      it("names that provider among the published auth methods", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        const { schema } = await app.publishedSchema();

        expect(schema["x-auth-methods"]?.sso).toEqual({ enabled: true, providers: ["google"] });
      });

      it("offers that provider on the published steps a sign-in starts from", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        const offering = await app.stepsOfferingSso();

        expect(offering.map((step) => step.name)).toEqual(
          expect.arrayContaining(["identifier", "register"]),
        );
        for (const step of offering) {
          expect(step.sso_providers, step.name).toEqual(["google"]);
          expect(Object.keys(step.transitions ?? {}), step.name).toContain("sso_authenticated");
        }
      });

      it("leaves nothing to reconcile after enabling one during setup", async () => {
        const app = await anApp();
        expect(await app.setupWithSso("google", SOCIAL_CREDENTIALS)).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });
    });
  });
});
