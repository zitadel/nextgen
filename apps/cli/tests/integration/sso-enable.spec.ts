import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = "google";
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/** A set-up project with the provider enabled but not yet applied. */
async function anAppWithGoogle(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.enableSso(GOOGLE, CREDENTIALS)).toSucceed();
  return app;
}

/** The same, with the edit published. */
async function anAppServingGoogle(): Promise<ScaffoldedApp> {
  const app = await anAppWithGoogle();
  expect(await app.apply()).toSucceed();
  return app;
}

describe("sso enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          "${{ GOOGLE_CLIENT_ID }}",
        );
      });
    });

    describe("that is down", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          "${{ GOOGLE_CLIENT_ID }}",
        );
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("publishes the client id as a readable project variable", async () => {
        const app = await anAppWithGoogle();

        const published = await app.projectVariables();

        expect(published).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "GOOGLE_CLIENT_ID", value: CREDENTIALS.clientId }),
          ]),
        );
      });

      it("publishes the secret without its value", async () => {
        const app = await anAppWithGoogle();

        const published = await app.projectVariables();

        const held = published.find((variable) => variable.name === "GOOGLE_CLIENT_SECRET");
        expect(held).toMatchObject({ secret: true });
        expect(held).not.toHaveProperty("value");
      });

      it("reports which variable each credential was stored as", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        const { data } = app.envelopeOf<{
          client_id: { variable: string; published: string };
        }>(result);
        expect(data.client_id).toEqual({ variable: "GOOGLE_CLIENT_ID", published: "stored" });
      });

      it("commits references to the credentials rather than the credentials", async () => {
        const app = await anAppWithGoogle();

        const connection = await app.committed.idpConnection(GOOGLE);

        expect(connection.oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
        expect(connection.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
      });

      it("keeps both credentials out of every committed document", async () => {
        const app = await anAppWithGoogle();

        const written = await app.committed.asText(GOOGLE);

        expect(written).not.toContain(CREDENTIALS.secret);
        expect(written).not.toContain(CREDENTIALS.clientId);
      });

      it("leaves the provider for apply to publish", async () => {
        const app = await anAppWithGoogle();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
        expect(await app.registeredIdps()).toEqual([]);
      });

      it("changes nothing when the same provider is enabled again", async () => {
        const app = await anAppWithGoogle();
        const before = {
          variables: await app.projectVariables(),
          connection: await app.committed.idpConnection(GOOGLE),
        };

        expect(await app.enableSso(GOOGLE, CREDENTIALS)).toSucceed();

        expect(await app.projectVariables()).toEqual(before.variables);
        expect(await app.committed.idpConnection(GOOGLE)).toEqual(before.connection);
      });

      describe("once applied", () => {
        it("registers the provider with the platform", async () => {
          const app = await anAppServingGoogle();

          const registered = await app.registeredIdps();

          expect(registered.map((idp) => idp.slug)).toEqual([GOOGLE]);
        });

        it("names the provider among the published auth methods", async () => {
          const app = await anAppServingGoogle();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.sso).toEqual({ enabled: true, providers: [GOOGLE] });
        });

        it("offers the provider on the steps a sign-in starts from", async () => {
          const app = await anAppServingGoogle();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).toEqual(
            expect.arrayContaining(["identifier", "register"]),
          );
          for (const step of offering) {
            expect(step.sso_providers).toEqual([GOOGLE]);
          }
        });

        it("says where each offering step returns from the provider", async () => {
          const app = await anAppServingGoogle();

          const offering = await app.stepsOfferingSso();

          for (const step of offering) {
            expect(Object.keys(step.transitions ?? {}), step.name).toContain("callback");
          }
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anAppServingGoogle();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });
  });
});
