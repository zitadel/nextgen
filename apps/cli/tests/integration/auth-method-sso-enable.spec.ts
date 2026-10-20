import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import {
  aSetUpApp,
  type CliResult,
  type CustomConnection,
  type FlowDocument,
  type ScaffoldedApp,
} from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = "google";
const PRESETS = ["passkey-first", "password-first"] as const;
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

const ACME: CustomConnection = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};
const ACME_CREDENTIALS = { clientId: "acme-client-id", secret: "acme-client-secret" };

/** A provider `auth-method sso enable` can add, and how to ask for it. */
type Provider = {
  readonly name: string;
  readonly slug: string;
  readonly variables: string;
  readonly credentials: { clientId: string; secret: string };
  readonly enable: (app: ScaffoldedApp) => Promise<CliResult>;
};

/** The two kinds of provider, which share every behaviour that is not about what makes one custom. */
const PROVIDERS: readonly Provider[] = [
  {
    name: "a catalog provider",
    slug: GOOGLE,
    variables: "GOOGLE",
    credentials: CREDENTIALS,
    enable: (app) => app.enableSso(GOOGLE, CREDENTIALS),
  },
  {
    name: "a custom connection",
    slug: ACME.slug,
    variables: "ACME_SSO",
    credentials: ACME_CREDENTIALS,
    enable: (app) => app.enableCustomSso(ACME, ACME_CREDENTIALS),
  },
];

/** A set-up project with the provider enabled but not yet applied. */
async function anAppWith(provider: Provider): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await provider.enable(app);
  return app;
}

/** The same, with the edit published. */
async function anAppServing(provider: Provider): Promise<ScaffoldedApp> {
  const app = await anAppWith(provider);
  await app.apply();
  return app;
}

/** A set-up project with a custom connection enabled, not applied, for specs that only plan. */
const anAppWithAcme = () => anAppWith(PROVIDERS[1] as Provider);

/** A set-up project serving a custom connection. */
const anAppServingAcme = () => anAppServing(PROVIDERS[1] as Provider);

describe("auth-method sso enable", () => {
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
      describe.each(PROVIDERS)("with $name", (provider) => {
        it("publishes the client id as a readable project variable", async () => {
          const app = await anAppWith(provider);

          const published = await app.projectVariables();

          expect(published).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: `${provider.variables}_CLIENT_ID`,
                value: provider.credentials.clientId,
              }),
            ]),
          );
        });

        it("publishes the secret without its value", async () => {
          const app = await anAppWith(provider);

          const published = await app.projectVariables();

          const held = published.find(
            (variable) => variable.name === `${provider.variables}_CLIENT_SECRET`,
          );
          expect(held).toMatchObject({ secret: true });
          expect(held).not.toHaveProperty("value");
        });

        it("reports the variable the client id was stored as", async () => {
          const app = await aSetUpApp();

          const result = await provider.enable(app);

          const { data } = app.envelopeOf<{ client_id: { variable: string; published: string } }>(
            result,
          );
          expect(data.client_id).toEqual({
            variable: `${provider.variables}_CLIENT_ID`,
            published: "stored",
          });
        });

        it("reports the variable the secret was stored as", async () => {
          const app = await aSetUpApp();

          const result = await provider.enable(app);

          const { data } = app.envelopeOf<{ secret: { variable: string; published: string } }>(
            result,
          );
          expect(data.secret).toEqual({
            variable: `${provider.variables}_CLIENT_SECRET`,
            published: "stored",
          });
        });

        it("commits a reference to the client id", async () => {
          const app = await anAppWith(provider);

          const connection = await app.committed.idpConnection(provider.slug);

          expect(connection.oidc.client_id).toBe(`\${{ ${provider.variables}_CLIENT_ID }}`);
        });

        it("commits a reference to the client secret", async () => {
          const app = await anAppWith(provider);

          const connection = await app.committed.idpConnection(provider.slug);

          expect(connection.oidc.client_secret).toBe(`\${{ ${provider.variables}_CLIENT_SECRET }}`);
        });

        it("keeps the secret out of every file in the project", async () => {
          const app = await anAppWith(provider);

          expect(await app.filesContaining(provider.credentials.secret)).toEqual([]);
        });

        it("keeps the client id out of every file in the project", async () => {
          const app = await anAppWith(provider);

          expect(await app.filesContaining(provider.credentials.clientId)).toEqual([]);
        });

        it("leaves the provider for apply to publish", async () => {
          const app = await anAppWith(provider);

          const result = await app.plan();

          expect(result.total).toBeGreaterThan(0);
        });

        it("registers nothing with the platform until apply", async () => {
          const app = await anAppWith(provider);

          expect(await app.registeredIdps()).toEqual([]);
        });

        it("succeeds when enabled again", async () => {
          const app = await anAppServing(provider);

          const result = await provider.enable(app);

          expect(result).toSucceed();
        });

        it("changes no file when enabled again", async () => {
          const app = await anAppServing(provider);
          const files = await app.snapshot();

          await provider.enable(app);

          expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        });

        it("leaves nothing to reconcile when enabled again", async () => {
          const app = await anAppServing(provider);

          await provider.enable(app);

          expect(await app.plan()).toReportNothingToDo();
        });

        it("republishes nothing when enabled again", async () => {
          const app = await anAppServing(provider);
          const before = await app.projectVariables();

          await provider.enable(app);

          expect(await app.projectVariables()).toEqual(before);
        });

        describe("once applied", () => {
          it("registers the provider with the platform", async () => {
            const app = await anAppServing(provider);

            const registered = await app.registeredIdps();

            expect(registered.map((idp) => idp.slug)).toEqual([provider.slug]);
          });

          it("names the provider among the published auth methods", async () => {
            const app = await anAppServing(provider);

            const { schema } = await app.publishedSchema();

            expect(schema["x-auth-methods"]?.sso).toEqual({
              enabled: true,
              providers: [provider.slug],
            });
          });

          it("offers the provider on the steps a sign-in starts from", async () => {
            const app = await anAppServing(provider);

            const offering = await app.stepsOfferingSso();

            expect(offering.map((step) => step.name)).toEqual(
              expect.arrayContaining(["identifier", "register"]),
            );
          });

          it("offers only the provider on every step that offers one", async () => {
            const app = await anAppServing(provider);

            for (const step of await app.stepsOfferingSso()) {
              expect(step.sso_providers, step.name).toEqual([provider.slug]);
            }
          });

          it("says where each offering step returns from the provider", async () => {
            const app = await anAppServing(provider);

            for (const step of await app.stepsOfferingSso()) {
              expect(Object.keys(step.transitions ?? {}), step.name).toContain("sso_authenticated");
            }
          });

          it("leaves nothing to reconcile", async () => {
            const app = await anAppServing(provider);

            expect(await app.plan()).toReportNothingToDo();
          });
        });
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

      describe("a custom connection beside another to the same issuer", () => {
        const staff = { ...ACME, slug: "acme-staff", displayName: "Acme staff" };
        const staffCredentials = { clientId: "staff-client-id", secret: "staff-client-secret" };

        /** Two custom connections to one issuer, both applied. */
        async function anAppServingBoth(): Promise<ScaffoldedApp> {
          const app = await anAppServingAcme();
          await app.enableCustomSso(staff, staffCredentials);
          await app.apply();
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

        it("offers both on the conflict step too", async () => {
          const app = await anAppServingBoth();

          const conflict = (await app.stepsOfferingSso()).find(
            (step) => step.name === "sso-conflict",
          );

          expect(conflict?.sso_providers).toEqual(["acme-sso", "acme-staff"]);
        });
      });

      describe("a custom connection beside Google", () => {
        /** Google and a custom connection, both applied. */
        async function anAppServingBothKinds(): Promise<ScaffoldedApp> {
          const app = await anAppServing(PROVIDERS[0] as Provider);
          await app.enableCustomSso(ACME, ACME_CREDENTIALS);
          await app.apply();
          return app;
        }

        it("offers both on every step that offers either", async () => {
          const app = await anAppServingBothKinds();

          for (const step of await app.stepsOfferingSso()) {
            expect(step.sso_providers, step.name).toEqual([GOOGLE, "acme-sso"]);
          }
        });

        it("is not claimed by Google when it points at Google's issuer", async () => {
          const app = await aSetUpApp();
          const corp = { ...ACME, slug: "corp", issuer: "https://accounts.google.com" };
          await app.enableCustomSso(corp, ACME_CREDENTIALS);
          await app.enableSso(GOOGLE, CREDENTIALS);
          await app.apply();

          const registered = await app.registeredIdps();

          expect(registered.map((idp) => idp.slug).sort()).toEqual(["corp", GOOGLE]);
        });
      });

      describe("a custom connection with claim mappings", () => {
        const STAFF_NUMBER = ["--claim", "staffNumber=employee_id:integer"];

        /** A project whose user schema also holds an integer `staffNumber`. */
        async function anAppWithStaffNumbers(): Promise<ScaffoldedApp> {
          const app = await aSetUpApp(["--use-case", "business"]);
          await app.editUserSchema((schema) => {
            schema.properties.staffNumber = { type: "integer" };
            schema.properties.badge = { type: "string" };
          });
          return app;
        }

        const reported = (app: ScaffoldedApp, result: CliResult) =>
          app.envelopeOf<{ connection: Record<string, unknown> }>(result).data.connection;

        it("maps the standard claims whose names the schema has", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS);

          expect(reported(app, result).claim_mapping).toEqual({
            email: "email",
            givenName: "given_name",
            familyName: "family_name",
          });
        });

        it("fills a property from the claim it is given", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, STAFF_NUMBER);

          expect(reported(app, result).claim_mapping).toMatchObject({ staffNumber: "employee_id" });
        });

        it("applies once the mapping is in", async () => {
          const app = await anAppWithStaffNumbers();
          await app.enableCustomSso(ACME, ACME_CREDENTIALS, STAFF_NUMBER);

          const result = await app.apply();

          expect(result).toSucceed();
        });

        it("registers the mapping, its verification and its scopes with the platform", async () => {
          const app = await anAppWithStaffNumbers();
          await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            ...STAFF_NUMBER,
            "--verified-claim",
            "staffNumber=true",
            "--claim-scope",
            "employee",
          ]);
          await app.apply();

          const [registered] = await app.registeredIdps();

          expect(registered?.definition).toMatchObject({
            claim_mapping: { staffNumber: "employee_id", email: "email" },
            verified_claims: { staffNumber: true, email: "email_verified" },
            oidc: { scopes: ["openid", "profile", "email", "employee"] },
          });
        });

        it("asks the provider for the scopes the claims need", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            ...STAFF_NUMBER,
            "--claim-scope",
            "employee",
          ]);

          expect(reported(app, result).scopes).toEqual(["openid", "profile", "email", "employee"]);
        });

        it("records how a mapped property is verified", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            ...STAFF_NUMBER,
            "--verified-claim",
            "staffNumber=true",
          ]);

          expect(reported(app, result).verified_claims).toMatchObject({ staffNumber: true });
        });

        it("refuses a string claim for an integer property and says how to declare it", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            "--claim",
            "staffNumber=employee_id",
          ]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("refuses a claim that already fills another property", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            "--claim",
            "badge=given_name",
          ]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("refuses a property the schema does not define", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            "--claim",
            "shoeSize=shoe",
          ]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("refuses to verify a property it does not map", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            "--verified-claim",
            "staffNumber=true",
          ]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("names the flag that carried an entry it cannot read", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, ["--claim", "nonsense"]);

          expect(result).toExplain("--claim");
        });

        it("writes nothing for a mapping it refuses", async () => {
          const app = await anAppWithStaffNumbers();
          const before = await app.snapshot();

          await app.enableCustomSso(ACME, ACME_CREDENTIALS, ["--claim", "staffNumber=employee_id"]);

          expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        });

        it("replaces a mapped default with the claim it is given", async () => {
          const app = await anAppWithStaffNumbers();
          await app.enableCustomSso(ACME, ACME_CREDENTIALS, ["--claim", "email=mail"]);
          await app.apply();

          const [registered] = await app.registeredIdps();

          expect(registered?.definition?.claim_mapping).toMatchObject({ email: "mail" });
        });

        it("no longer verifies a default it replaced, and says so", async () => {
          const app = await anAppWithStaffNumbers();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            "--claim",
            "email=mail",
          ]);

          expect(result).toSay("--verified-claim email=<claim>");
        });

        it("verifies a replaced default by the claim it is then given", async () => {
          const app = await anAppWithStaffNumbers();
          await app.enableCustomSso(ACME, ACME_CREDENTIALS, [
            "--claim",
            "email=mail",
            "--verified-claim",
            "email=mail_verified",
          ]);
          await app.apply();

          const [registered] = await app.registeredIdps();

          expect(registered?.definition?.verified_claims).toEqual({ email: "mail_verified" });
        });

        it("warns that the claims were not applied to a connection that already exists", async () => {
          const app = await anAppWithAcme();

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS, STAFF_NUMBER);

          expect(result).toSay("claims you gave were not applied");
        });
      });

      describe("a custom connection enabled again", () => {
        it("warns when the scopes differ", async () => {
          const app = await anAppWithAcme();

          const result = await app.enableCustomSso(
            { ...ACME, scopes: "openid groups" },
            ACME_CREDENTIALS,
          );

          expect(result).toSay("not applied");
        });

        it("does not warn about scopes the developer did not pass this time", async () => {
          const app = await aSetUpApp();
          await app.enableCustomSso({ ...ACME, scopes: "openid groups" }, ACME_CREDENTIALS);

          const result = await (PROVIDERS[1] as Provider).enable(app);

          expect(result).not.toSay("not applied");
        });

        it("warns when the display name differs", async () => {
          const app = await anAppWithAcme();

          const result = await app.enableCustomSso(
            { ...ACME, displayName: "Acme staff" },
            ACME_CREDENTIALS,
          );

          expect(result).toSay("not applied");
        });

        it("does not warn when nothing differs", async () => {
          const app = await anAppWithAcme();

          const result = await (PROVIDERS[1] as Provider).enable(app);

          expect(result).not.toSay("not applied");
        });
      });

      describe("a custom connection that would share a variable with another", () => {
        it("stops", async () => {
          const app = await anAppWithAcme();

          const result = await app.enableCustomSso(
            { ...ACME, slug: "acme_sso", displayName: "Acme again" },
            ACME_CREDENTIALS,
          );

          expect(result).toFailWith("E_CONFLICT");
        });
      });

      describe("a custom connection under the name of one to another provider", () => {
        it("stops", async () => {
          const app = await anAppWithAcme();

          const result = await app.enableCustomSso(
            { ...ACME, issuer: "https://sso.other.example" },
            ACME_CREDENTIALS,
          );

          expect(result).toFailWith("E_CONFLICT");
        });
      });

      describe("a custom connection the command refuses", () => {
        it("names the slug flag to fix", async () => {
          const app = await aSetUpApp();

          const result = await app.enableCustomSso({ ...ACME, slug: "google" }, ACME_CREDENTIALS);

          expect(result).toExplain("--slug");
        });
      });

      describe.each([
        ["a catalog provider", ["--provider", "google"]],
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
        const SCENARIOS = [
          {
            missing: "client secret",
            args: [...provider, "--client-id", "a-client-id"],
            secret: "",
            hint: "Pipe it in on stdin.",
          },
          {
            missing: "client id",
            args: provider,
            secret: "a-client-secret",
            hint: "Pass --client-id.",
          },
        ];

        it.each(SCENARIOS)("is refused for want of a $missing", async ({ args, secret }) => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(args, secret);

          expect(result).toFailWith("E_VALIDATION");
        });

        it.each(SCENARIOS)("says what to supply for want of a $missing", async (scenario) => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(scenario.args, scenario.secret);

          expect(result).toExplain(`No ${scenario.missing}`);
          expect(result).toHintAt(scenario.hint);
        });

        it.each(SCENARIOS)("writes no file for want of a $missing", async ({ args, secret }) => {
          const app = await aSetUpApp();
          const before = await app.snapshot();

          await app.enableSsoWith(args, secret);

          expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        });

        it.each(SCENARIOS)(
          "publishes no variable for want of a $missing",
          async ({ args, secret }) => {
            const app = await aSetUpApp();

            await app.enableSsoWith(args, secret);

            expect(await app.projectVariables()).toEqual([]);
          },
        );
      });
    });

    describe.each([
      {
        missing: "client secret",
        args: ["--provider", "google", "--client-id", "a-client-id"],
        secret: "",
        suggests: "auth-method sso enable --provider google --client-id a-client-id",
      },
      {
        missing: "client id",
        args: ["--provider", "google"],
        secret: "a-client-secret",
        suggests: "auth-method sso enable --provider google --client-id <client-id>",
      },
    ])("a catalog provider without a $missing", ({ args, secret, suggests }) => {
      it("suggests the command to run once it is to hand", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoWith(args, secret);

        expect(result).toSuggest(suggests);
      });
    });

    describe("a catalog provider with claims but without a client secret", () => {
      it("suggests the command to run with the claims it was given", async () => {
        const app = await aSetUpApp(["--use-case", "business"]);

        const result = await app.enableSsoWith(
          [
            "--provider",
            "google",
            "--client-id",
            "a-client-id",
            "--claim",
            "companyName=organization",
            "--claim-scope",
            "organization",
          ],
          "",
        );

        expect(result).toSuggest(
          "--client-id a-client-id --claim companyName=organization --claim-scope organization",
        );
      });
    });

    describe("rendered for a terminal", () => {
      it("says which provider it enabled, and for which schema", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

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
