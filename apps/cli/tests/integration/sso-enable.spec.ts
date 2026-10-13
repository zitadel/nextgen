import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type CustomConnection, type ScaffoldedApp } from "../helpers/project";

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

const ACME: CustomConnection = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};
const ACME_CREDENTIALS = { clientId: "acme-client-id", secret: "acme-client-secret" };

/** A set-up project serving a custom connection. */
async function anAppServingAcme(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();
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

    describe("that refuses connections", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

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
          secret: { variable: string; published: string };
        }>(result);
        expect(data.client_id).toEqual({ variable: "GOOGLE_CLIENT_ID", published: "stored" });
        expect(data.secret).toEqual({ variable: "GOOGLE_CLIENT_SECRET", published: "stored" });
      });

      it("commits references to the credentials rather than the credentials", async () => {
        const app = await anAppWithGoogle();

        const connection = await app.committed.idpConnection(GOOGLE);

        expect(connection.oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
        expect(connection.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
      });

      it("keeps both credentials out of every file in the project", async () => {
        const app = await anAppWithGoogle();

        expect(await app.filesContaining(CREDENTIALS.secret)).toEqual([]);
        expect(await app.filesContaining(CREDENTIALS.clientId)).toEqual([]);
      });

      it("leaves the provider for apply to publish", async () => {
        const app = await anAppWithGoogle();

        const result = await app.plan();

        expect(result.total).toBeGreaterThan(0);
        expect(await app.registeredIdps()).toEqual([]);
      });

      it("changes nothing when the same provider is enabled again", async () => {
        const app = await anAppServingGoogle();
        const files = await app.snapshot();
        const before = {
          variables: await app.projectVariables(),
          connection: await app.committed.idpConnection(GOOGLE),
          schema: await app.publishedSchema(),
          flow: await app.publishedFlow(),
        };

        expect(await app.enableSso(GOOGLE, CREDENTIALS)).toSucceed();

        expect(await app.projectVariables()).toEqual(before.variables);
        expect(await app.committed.idpConnection(GOOGLE)).toEqual(before.connection);
        expect(await app.publishedSchema()).toEqual(before.schema);
        expect(await app.publishedFlow()).toEqual(before.flow);
        expect(await app.plan()).toReportNothingToDo();
        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
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
            expect(Object.keys(step.transitions ?? {}), step.name).toContain("sso_authenticated");
          }
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anAppServingGoogle();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });

    describe("a custom connection", () => {
      it("registers the connection under the name the developer gave it", async () => {
        const app = await anAppServingAcme();

        const registered = await app.registeredIdps();

        expect(registered.map((idp) => idp.slug)).toEqual([ACME.slug]);
      });

      it("commits references to the credentials rather than the credentials", async () => {
        const app = await aSetUpApp();
        expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();

        const connection = await app.committed.idpConnection(ACME.slug);

        expect(connection.oidc.client_id).toBe("${{ ACME_SSO_CLIENT_ID }}");
        expect(connection.oidc.client_secret).toBe("${{ ACME_SSO_CLIENT_SECRET }}");
      });

      it("publishes the client id as a readable project variable", async () => {
        const app = await aSetUpApp();
        expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();

        const published = await app.projectVariables();

        expect(published).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "ACME_SSO_CLIENT_ID", value: "acme-client-id" }),
          ]),
        );
      });

      it("keeps the secret out of every file in the project", async () => {
        const app = await aSetUpApp();
        expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();

        expect(await app.filesContaining(ACME_CREDENTIALS.secret)).toEqual([]);
      });

      it("names the connection among the published auth methods", async () => {
        const app = await anAppServingAcme();

        const { schema } = await app.publishedSchema();

        expect(schema["x-auth-methods"]?.sso).toEqual({ enabled: true, providers: ["acme-sso"] });
      });

      it("offers the connection on the steps a sign-in starts from", async () => {
        const app = await anAppServingAcme();

        const offering = await app.stepsOfferingSso();

        expect(offering.map((step) => step.name)).toEqual(
          expect.arrayContaining(["identifier", "register"]),
        );
      });

      it("leaves nothing to reconcile when the same connection is enabled again", async () => {
        const app = await anAppServingAcme();

        expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      it("changes no file when the same connection is enabled again", async () => {
        const app = await anAppServingAcme();
        const files = await app.snapshot();

        expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      describe("beside another connection to the same issuer", () => {
        const staff = { ...ACME, slug: "acme-staff", displayName: "Acme staff" };
        const staffCredentials = { clientId: "staff-client-id", secret: "staff-client-secret" };

        async function anAppServingBoth(): Promise<ScaffoldedApp> {
          const app = await anAppServingAcme();
          expect(await app.enableCustomSso(staff, staffCredentials)).toSucceed();
          expect(await app.apply()).toSucceed();
          return app;
        }

        it("registers both", async () => {
          const app = await anAppServingBoth();

          expect((await app.registeredIdps()).map((idp) => idp.slug).sort()).toEqual([
            "acme-sso",
            "acme-staff",
          ]);
        });

        it("lists both among the published auth methods", async () => {
          const app = await anAppServingBoth();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.sso?.providers).toEqual(["acme-sso", "acme-staff"]);
        });

        it("offers both on every step that offers either", async () => {
          const app = await anAppServingBoth();

          for (const step of await app.stepsOfferingSso()) {
            expect(step.sso_providers, step.name).toEqual(["acme-sso", "acme-staff"]);
          }
        });

        it("adds the step that resolves a collision between them", async () => {
          const app = await anAppServingBoth();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).toContain("sso-conflict");
        });
      });

      it("offers a custom connection beside Google without disturbing it", async () => {
        const app = await anAppServingGoogle();
        expect(await app.enableCustomSso(ACME, ACME_CREDENTIALS)).toSucceed();
        expect(await app.apply()).toSucceed();

        for (const step of await app.stepsOfferingSso()) {
          expect(step.sso_providers, step.name).toEqual([GOOGLE, "acme-sso"]);
        }
      });

      it("stops when the name belongs to a connection to another provider", async () => {
        const app = await anAppServingAcme();

        const result = await app.enableCustomSso(
          { ...ACME, issuer: "https://sso.other.example" },
          ACME_CREDENTIALS,
        );

        expect(result).toFailWith("E_CONFLICT");
      });

      it.each([
        ["the name of a built-in provider", { ...ACME, slug: "google" }],
        ["scopes without openid", { ...ACME, scopes: "profile email" }],
        ["an issuer the server would refuse", { ...ACME, issuer: "http://sso.acme.example" }],
      ])("refuses %s and leaves the project as it was", async (_name, connection) => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        const result = await app.enableCustomSso(connection, ACME_CREDENTIALS);

        expect(result).toFailWith("E_VALIDATION");
        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("refuses a connection with no name, display name and issuer", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoWith(["--provider", "custom"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses the custom flags for a provider the catalog describes", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoWith([
          "--provider",
          "google",
          "--issuer",
          "https://sso.acme.example",
          "--client-id",
          CREDENTIALS.clientId,
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe.each([
      ["google", ["--provider", "google"]],
      [
        "a custom connection",
        [
          "--provider",
          "custom",
          "--slug",
          "acme-sso",
          "--display-name",
          "Acme SSO",
          "--issuer",
          "https://sso.acme.example",
        ],
      ],
    ])("%s without both credentials", (_name, provider) => {
      it("will not enable the provider without a client secret", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        const result = await app.enableSsoWith([...provider, "--client-id", "a-client-id"], "");

        expect(result).toFailWith("E_VALIDATION");
        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        expect(await app.projectVariables()).toEqual([]);
      });

      it("will not enable the provider without a client id", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        const result = await app.enableSsoWith(provider, "a-client-secret");

        expect(result).toFailWith("E_VALIDATION");
        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        expect(await app.projectVariables()).toEqual([]);
      });
    });

    describe("rendered for a terminal", () => {
      it("says which provider it enabled, and for which schema", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
        expect(result).toPrint("Enabled Google for default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrintNoJson();
      });
    });
  });
});
