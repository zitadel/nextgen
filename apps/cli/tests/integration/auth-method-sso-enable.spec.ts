import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aSetUpApp,
  type Credentials,
  type CustomConnection,
  type FlowDocument,
  type ScaffoldedApp,
} from "@tests/helpers/project";

const platform = usePlatformMock();

/**
 * A step of the committed login flow.
 */
type Step = FlowDocument["steps"][number];

/**
 * The catalog provider the specs enable.
 */
const GOOGLE = "google";

/**
 * Google's client id and secret.
 */
const CREDENTIALS: Credentials = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/**
 * What the committed Google connection holds in place of the client id.
 */
const GOOGLE_CLIENT_ID_REFERENCE = "${{ GOOGLE_CLIENT_ID }}";

/**
 * A connection the catalog does not list, described by the developer.
 */
const ACME: CustomConnection = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};

/**
 * The custom connection's client id and secret.
 */
const ACME_CREDENTIALS: Credentials = { clientId: "acme-client-id", secret: "acme-client-secret" };

/**
 * A second custom connection to Acme's issuer.
 */
const STAFF: CustomConnection = { ...ACME, slug: "acme-staff", displayName: "Acme staff" };

/**
 * The second custom connection's client id and secret.
 */
const STAFF_CREDENTIALS: Credentials = {
  clientId: "staff-client-id",
  secret: "staff-client-secret",
};

/**
 * A custom connection whose issuer is Google's own.
 */
const CORP: CustomConnection = { ...ACME, slug: "corp", issuer: "https://accounts.google.com" };

/**
 * The presets whose login has a password step to offer providers on.
 */
const PRESETS = ["passkey-first", "password-first"] as const;

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

/**
 * What the command says when it keeps what is committed over a flag that
 * differs from it.
 */
const NOT_APPLIED = "not applied";

/**
 * The warning a credential that may not read variables back must not raise.
 *
 * The secret was stored; only reading back what the name now holds was
 * refused, and a report nobody could make is not a failed write. Saying it
 * could not be published would send the developer to re-run a write that
 * already happened, with a secret they may no longer hold.
 */
const UNPUBLISHED_SECRET = "GOOGLE_CLIENT_SECRET could not be published";

/**
 * The flags naming Google, without a client id.
 */
const GOOGLE_FLAGS = ["--provider", GOOGLE];

/**
 * The flags describing the Acme connection, without a client id.
 */
const ACME_FLAGS = [
  "--provider",
  "custom",
  "--slug",
  ACME.slug,
  "--display-name",
  ACME.displayName,
  "--issuer",
  ACME.issuer,
];

/**
 * A provider `auth-method sso enable` can add, and the flags that ask for it.
 */
type Provider = {
  readonly name: string;
  readonly slug: string;
  readonly variables: string;
  readonly credentials: Credentials;
  readonly flags: string[];
};

/**
 * Google, from the catalog.
 */
const CATALOG: Provider = {
  name: "a catalog provider",
  slug: GOOGLE,
  variables: "GOOGLE",
  credentials: CREDENTIALS,
  flags: [...GOOGLE_FLAGS, "--client-id", CREDENTIALS.clientId],
};

/**
 * Acme, described by the developer.
 */
const CUSTOM: Provider = {
  name: "a custom connection",
  slug: ACME.slug,
  variables: "ACME_SSO",
  credentials: ACME_CREDENTIALS,
  flags: [...ACME_FLAGS, "--client-id", ACME_CREDENTIALS.clientId],
};

/**
 * The two kinds of provider, which share every behaviour that is not about
 * what makes one custom.
 */
const PROVIDERS: readonly Provider[] = [CATALOG, CUSTOM];

/**
 * Leaves a password step saying something of its own.
 *
 * @param step - The password step.
 */
function withOwnCopy(step: Step): void {
  const [action] = step.actions ?? [];
  if (action !== undefined) {
    action.text_key = "my.own.copy";
  }
}

/**
 * Leaves a hand-edited password step offering Google with every route back
 * from it, as a developer who added them would.
 *
 * @param step - The password step.
 */
function withOwnCopyAndGoogle(step: Step): void {
  withOwnCopy(step);
  step.sso_providers = [GOOGLE];
  step.transitions = {
    submit: { target: "done" },
    sso_authenticated: { target: "done" },
    sso_user_not_found: { target: "register-sso" },
    user_already_exists: { target: "sso-conflict" },
  };
}

/**
 * Takes a password step back to before it offered providers: no providers and
 * no route back from one.
 *
 * @param step - The password step.
 */
function withoutProviders(step: Step): void {
  delete step.sso_providers;
  step.transitions = Object.fromEntries(
    Object.entries(step.transitions ?? {}).filter(([outcome]) => {
      return !outcome.startsWith("sso_") && outcome !== "user_already_exists";
    }),
  );
}

/**
 * A set-up project with the provider enabled but not yet deployed.
 *
 * @param provider - The provider to enable.
 * @returns The project.
 */
async function anAppWith(provider: Provider): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasEnabledSsoWith(provider.flags, provider.credentials.secret);
  return app;
}

/**
 * A set-up project with the provider enabled and deployed.
 *
 * @param provider - The provider to enable.
 * @returns The project.
 */
async function anAppServing(provider: Provider): Promise<ScaffoldedApp> {
  const app = await anAppWith(provider);
  await app.publishData();
  return app;
}

describe("auth-method sso enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
      });

      it("still commits a reference to the client id", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        await app.enableSso(GOOGLE, CREDENTIALS);

        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          GOOGLE_CLIENT_ID_REFERENCE,
        );
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
      });

      it("still commits a reference to the client id", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        await app.enableSso(GOOGLE, CREDENTIALS);

        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          GOOGLE_CLIENT_ID_REFERENCE,
        );
      });
    });

    describe("that will not let the credential read variables back", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesVariableReads();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
      });

      it("does not say the secret could not be published", async () => {
        const app = await aSetUpApp();
        platform.refusesVariableReads();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).not.toSay(UNPUBLISHED_SECRET);
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.enableSso(GOOGLE, CREDENTIALS);

        expect(result).toSucceed();
      });

      it("still commits a reference to the client id", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        await app.enableSso(GOOGLE, CREDENTIALS);

        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          GOOGLE_CLIENT_ID_REFERENCE,
        );
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["auth-method", "sso", "enable", "--non-interactive", ...CATALOG.flags];

      await app.inEveryRendering((how) => {
        return app.pipingStdin(CREDENTIALS.secret, () => {
          return app.run(how.json ? [...args, "--json"] : args, how.env);
        });
      });
    });

    describe("--json", () => {
      describe.each(PROVIDERS)("with $name", (provider) => {
        it("publishes the client id as a readable project variable", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(await app.projectVariables()).toContainEqual(
            expect.objectContaining({
              name: `${provider.variables}_CLIENT_ID`,
              value: provider.credentials.clientId,
            }),
          );
        });

        it("publishes the secret without its value", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(await app.projectVariables()).toContainEqual({
            name: `${provider.variables}_CLIENT_SECRET`,
            secret: true,
          });
        });

        it("reports the variable the client id was stored as", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(app.envelopeOf(result).data.client_id).toEqual({
            variable: `${provider.variables}_CLIENT_ID`,
            published: "stored",
          });
        });

        it("reports the claim mapping of the connection file", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

          const { data } = app.envelopeOf<{
            connection: { claim_mapping: Record<string, string> };
          }>(result);
          expect(data.connection.claim_mapping).toEqual({ email: "email" });
        });

        it("reports what verifies the email apart from the mapping", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

          const { data } = app.envelopeOf<{
            connection: { verified_claims: Record<string, string> };
          }>(result);
          expect(data.connection.verified_claims).toEqual({ email: "email_verified" });
        });

        it("reports the variable the secret was stored as", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(app.envelopeOf(result).data.secret).toEqual({
            variable: `${provider.variables}_CLIENT_SECRET`,
            published: "stored",
          });
        });

        it("commits a reference to the client id", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect((await app.committed.idpConnection(provider.slug)).oidc.client_id).toBe(
            `\${{ ${provider.variables}_CLIENT_ID }}`,
          );
        });

        it("commits a reference to the client secret", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect((await app.committed.idpConnection(provider.slug)).oidc.client_secret).toBe(
            `\${{ ${provider.variables}_CLIENT_SECRET }}`,
          );
        });

        it("keeps the secret out of every file in the project", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(await app.filesContaining(provider.credentials.secret)).toEqual([]);
        });

        it("keeps the client id out of every file in the project", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(await app.filesContaining(provider.credentials.clientId)).toEqual([]);
        });

        it("registers nothing with the platform until a deploy", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(await app.registeredIdps()).toEqual([]);
        });

        describe("when enabled again", () => {
          it("succeeds", async () => {
            const app = await anAppServing(provider);

            const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(result).toSucceed();
          });

          it("changes no file", async () => {
            const app = await anAppServing(provider);
            const files = await app.snapshot();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await files.changes()).toMatchObject(NO_CHANGES);
          });

          it("leaves nothing to reconcile", async () => {
            const app = await anAppServing(provider);

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.deployDryRun()).toSucceed();
          });

          it("republishes nothing", async () => {
            const app = await anAppServing(provider);
            const before = await app.projectVariables();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.projectVariables()).toEqual(before);
          });
        });

        describe("once deployed", () => {
          it("registers the provider with the platform", async () => {
            const app = await aSetUpApp();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.registeredIdpSlugsOnceDeployed()).toEqual([provider.slug]);
          });

          it("names the provider among the published auth methods", async () => {
            const app = await aSetUpApp();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.authMethodsOnceDeployed()).toHaveProperty("sso", {
              enabled: true,
              providers: [provider.slug],
            });
          });

          it.each(["identifier", "register"])(
            "offers the provider on the %s step a sign-in starts from",
            async (name) => {
              const app = await aSetUpApp();

              await app.enableSsoWith(provider.flags, provider.credentials.secret);

              expect(await app.stepsOfferingSsoOnceDeployed()).toContainEqual(
                expect.objectContaining({ name }),
              );
            },
          );

          it("offers only the provider on every step that offers one", async () => {
            const app = await aSetUpApp();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.providerListsOfferedOnceDeployed()).toEqual([[provider.slug]]);
          });

          it("says where each offering step returns from the provider", async () => {
            const app = await aSetUpApp();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.stepsOfferingSsoWithoutOnceDeployed("sso_authenticated")).toEqual([]);
          });

          it("leaves nothing to reconcile", async () => {
            const app = await aSetUpApp();

            await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(await app.deployDryRunOnceDeployed()).toSucceed();
          });
        });
      });

      describe.each(PRESETS)("on the %s preset", (preset) => {
        it("offers the provider on the password step", async () => {
          const app = await aSetUpApp(["--preset", preset]);

          await app.enableSso(GOOGLE, CREDENTIALS);

          expect(await app.stepsOfferingSsoOnceDeployed()).toContainEqual(
            expect.objectContaining({ name: "password" }),
          );
        });

        it("leaves nothing to reconcile once deployed", async () => {
          const app = await aSetUpApp(["--preset", preset]);

          await app.enableSso(GOOGLE, CREDENTIALS);

          expect(await app.deployDryRunOnceDeployed()).toSucceed();
        });

        it("reports no step as edited when enabled again after a deploy", async () => {
          const app = await aSetUpApp(["--preset", preset]);
          await app.hasEnabledSso(GOOGLE, CREDENTIALS);
          await app.publishData();

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(app.envelopeOf(result).data).toHaveProperty("notices", []);
        });

        it("catches a password step from before it offered providers up", async () => {
          const app = await aSetUpApp(["--preset", preset]);
          await app.hasEnabledSso(GOOGLE, CREDENTIALS);
          await app.editPasswordStep(withoutProviders);

          await app.enableSso(GOOGLE, CREDENTIALS);

          expect(await app.stepsOfferingSsoOnceDeployed()).toContainEqual(
            expect.objectContaining({ name: "password" }),
          );
        });
      });

      describe("a password step the developer edited by hand", () => {
        it("does not get the provider", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(withOwnCopy);

          await app.enableSso(GOOGLE, CREDENTIALS);

          expect(await app.stepsOfferingSsoOnceDeployed()).not.toContainEqual(
            expect.objectContaining({ name: "password" }),
          );
        });

        it("is reported as left alone", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(withOwnCopy);

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(app.envelopeOf(result).data.notices).toHaveLength(1);
        });

        it("is not reported again once the developer has added the provider and its routes", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(withOwnCopyAndGoogle);

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(app.envelopeOf(result).data).toHaveProperty("notices", []);
        });
      });

      describe("a custom connection beside another to the same issuer", () => {
        it("registers both", async () => {
          const app = await anAppServing(CUSTOM);

          await app.enableCustomSso(STAFF, STAFF_CREDENTIALS);

          expect(await app.registeredIdpSlugsOnceDeployed()).toEqual([ACME.slug, STAFF.slug]);
        });

        it("lists both among the published auth methods", async () => {
          const app = await anAppServing(CUSTOM);

          await app.enableCustomSso(STAFF, STAFF_CREDENTIALS);

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("sso.providers", [
            ACME.slug,
            STAFF.slug,
          ]);
        });

        it("offers both on every step that offers either", async () => {
          const app = await anAppServing(CUSTOM);

          await app.enableCustomSso(STAFF, STAFF_CREDENTIALS);

          expect(await app.providerListsOfferedOnceDeployed()).toEqual([[ACME.slug, STAFF.slug]]);
        });

        it("offers both on the conflict step too", async () => {
          const app = await anAppServing(CUSTOM);

          await app.enableCustomSso(STAFF, STAFF_CREDENTIALS);

          expect(await app.stepsOfferingSsoOnceDeployed()).toContainEqual(
            expect.objectContaining({
              name: "sso-conflict",
              sso_providers: [ACME.slug, STAFF.slug],
            }),
          );
        });
      });

      describe("a custom connection beside Google", () => {
        it("offers both on every step that offers either", async () => {
          const app = await anAppServing(CATALOG);

          await app.enableCustomSso(ACME, ACME_CREDENTIALS);

          expect(await app.providerListsOfferedOnceDeployed()).toEqual([[GOOGLE, ACME.slug]]);
        });

        it("is not claimed by Google when it points at Google's issuer", async () => {
          const app = await aSetUpApp();
          await app.hasEnabledCustomSso(CORP, ACME_CREDENTIALS);

          await app.enableSso(GOOGLE, CREDENTIALS);

          expect(await app.registeredIdpSlugsOnceDeployed()).toEqual([CORP.slug, GOOGLE]);
        });
      });

      describe("a custom connection enabled again", () => {
        it("warns when the scopes differ", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(
            { ...ACME, scopes: "openid groups" },
            ACME_CREDENTIALS,
          );

          expect(result).toSay(NOT_APPLIED);
        });

        it("does not warn about scopes the developer did not pass this time", async () => {
          const app = await aSetUpApp();
          await app.hasEnabledCustomSso({ ...ACME, scopes: "openid groups" }, ACME_CREDENTIALS);

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS);

          expect(result).not.toSay(NOT_APPLIED);
        });

        it("warns when the display name differs", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(
            { ...ACME, displayName: "Acme staff" },
            ACME_CREDENTIALS,
          );

          expect(result).toSay(NOT_APPLIED);
        });

        it("does not warn when nothing differs", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS);

          expect(result).not.toSay(NOT_APPLIED);
        });
      });

      describe("a custom connection that would share a variable with another", () => {
        it("stops", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(
            { ...ACME, slug: "acme_sso", displayName: "Acme again" },
            ACME_CREDENTIALS,
          );

          expect(result).toFailWith("E_CONFLICT");
        });
      });

      describe("a custom connection under the name of one to another provider", () => {
        it("stops", async () => {
          const app = await anAppWith(CUSTOM);

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

          const result = await app.enableCustomSso({ ...ACME, slug: GOOGLE }, ACME_CREDENTIALS);

          expect(result).toExplain("--slug");
        });
      });

      describe.each([
        { name: "a catalog provider", flags: GOOGLE_FLAGS },
        { name: "a custom connection", flags: ACME_FLAGS },
      ])("$name without both credentials", ({ flags }) => {
        const scenarios = [
          {
            missing: "client secret",
            args: [...flags, "--client-id", "a-client-id"],
            secret: "",
            hint: "Pipe it in on stdin.",
          },
          {
            missing: "client id",
            args: flags,
            secret: "a-client-secret",
            hint: "Pass --client-id.",
          },
        ];

        it.each(scenarios)("is refused for want of a $missing", async ({ args, secret }) => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(args, secret);

          expect(result).toFailWith("E_VALIDATION");
        });

        it.each(scenarios)("says what is missing for want of a $missing", async (scenario) => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(scenario.args, scenario.secret);

          expect(result).toExplain(`No ${scenario.missing}`);
        });

        it.each(scenarios)("says how to supply it for want of a $missing", async (scenario) => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(scenario.args, scenario.secret);

          expect(result).toHintAt(scenario.hint);
        });

        it.each(scenarios)("writes no file for want of a $missing", async ({ args, secret }) => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.enableSsoWith(args, secret);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it.each(scenarios)(
          "publishes no variable for want of a $missing",
          async ({ args, secret }) => {
            const app = await aSetUpApp();

            await app.enableSsoWith(args, secret);

            expect(await app.projectVariables()).toEqual([]);
          },
        );
      });

      describe.each([
        {
          missing: "client secret",
          args: [...GOOGLE_FLAGS, "--client-id", "a-client-id"],
          secret: "",
          suggests: "auth-method sso enable --provider google --client-id a-client-id",
        },
        {
          missing: "client id",
          args: GOOGLE_FLAGS,
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
    });

    describe("rendered for a terminal", () => {
      it("says the provider is configured locally and not yet live", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("Google sign-in is configured locally.");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrintNoJson();
      });

      it("ends with a box that summarises the connection", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("SIGN IN WITH GOOGLE");
      });

      it("shows what the connection would map on a dry run", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDryRun(GOOGLE, CREDENTIALS);

        expect(result).toPrint("email comes from the email claim");
      });

      it("shows the mapping a developer edited when enabled again, not a regenerated one", async () => {
        const app = await aSetUpApp();
        await app.enableSsoRendered(GOOGLE, CREDENTIALS);
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = { email: "mail" };
        });

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("email comes from the mail claim");
      });
    });
  });
});
