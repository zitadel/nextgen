import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type FlowDocument, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = "google";
const PRESETS = ["passkey-first", "password-first"] as const;
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

      describe.each(PRESETS)("on the %s preset", (preset) => {
        /** A project set up with the preset, serving Google, with the password step changed by `edit` first. */
        async function aPresetAppServingGoogle(
          edit?: (step: FlowDocument["steps"][number]) => void,
        ): Promise<ScaffoldedApp> {
          const app = await aSetUpApp(["--preset", preset]);
          if (edit !== undefined) {
            await app.editPasswordStep(edit);
          }
          await app.enableSso(GOOGLE, CREDENTIALS);
          await app.apply();
          return app;
        }

        it("offers the provider on the password step", async () => {
          const app = await aPresetAppServingGoogle();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).toContain("password");
        });

        it("leaves nothing to reconcile", async () => {
          const app = await aPresetAppServingGoogle();

          expect(await app.plan()).toReportNothingToDo();
        });

        it("reports no step as edited when enabled again after apply", async () => {
          const app = await aPresetAppServingGoogle();

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(app.envelopeOf<{ untouched: string[] }>(result).data.untouched).toEqual([]);
        });

        it("catches a password step from before it offered providers up", async () => {
          const app = await aSetUpApp(["--preset", preset]);
          await app.enableSso(GOOGLE, CREDENTIALS);
          await app.editPasswordStep((step) => {
            delete step.sso_providers;
            step.transitions = Object.fromEntries(
              Object.entries(step.transitions ?? {}).filter(
                ([outcome]) => !outcome.startsWith("sso_") && outcome !== "user_already_exists",
              ),
            );
          });
          await app.enableSso(GOOGLE, CREDENTIALS);
          await app.apply();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).toContain("password");
        });
      });

      describe("a password step the developer edited by hand", () => {
        const copy = (step: FlowDocument["steps"][number]) => {
          const [action] = step.actions ?? [];
          if (action !== undefined) {
            action.text_key = "my.own.copy";
          }
        };

        /** A set-up project whose password step says something of its own, with Google enabled and applied. */
        async function anAppServingGoogleWithAnEditedPasswordStep(): Promise<ScaffoldedApp> {
          const app = await aSetUpApp();
          await app.editPasswordStep(copy);
          await app.enableSso(GOOGLE, CREDENTIALS);
          await app.apply();
          return app;
        }

        it("does not get the provider", async () => {
          const app = await anAppServingGoogleWithAnEditedPasswordStep();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).not.toContain("password");
        });

        it("is reported as left alone", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(copy);

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(app.envelopeOf<{ untouched: string[] }>(result).data.untouched).toHaveLength(1);
        });

        it("is not reported again once the developer has added the provider and its routes", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep((step) => {
            copy(step);
            step.sso_providers = [GOOGLE];
            step.transitions = {
              submit: { target: "done" },
              sso_authenticated: { target: "done" },
              sso_user_not_found: { target: "register-sso" },
              user_already_exists: { target: "sso-conflict" },
            };
          });

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(app.envelopeOf<{ untouched: string[] }>(result).data.untouched).toEqual([]);
        });
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
