import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aSetUpApp,
  type Credentials,
  type CustomConnection,
  type FlowDocument,
  MOCK_SERVER_URL,
  type ScaffoldedApp,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

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
 * The schema the command changes, and the files it writes.
 */
const SCHEMA = "default-human-user";
const SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";
const FLOW_FILE = ".zitadel/flows/default-login.json";

/**
 * What the connection of a catalog provider or a custom one maps, which both
 * start from.
 */
const DEFAULT_CONNECTION = {
  claim_mapping: { email: "email" },
  verified_claims: { email: "email_verified" },
  scopes: ["openid", "profile", "email"],
  unmapped: [],
  used_by: [SCHEMA],
};

/**
 * What the command warns when it leaves a hand-edited password step alone.
 */
const HAND_EDITED_WARNING =
  ".zitadel/flows/default-login.json steps.password has been edited by hand, so it was left alone. Add google to its sso_providers, and route sso_authenticated to the step a sign-in ends on, sso_user_not_found to register-sso and user_already_exists to sso-conflict.";

/**
 * What the command warns when a flag differs from the connection it keeps.
 */
const SCOPES_NOT_APPLIED =
  ".zitadel/idps/acme-sso.json already exists, so the scopes you gave was not applied. Edit the file to change it.";
const DISPLAY_NAME_NOT_APPLIED =
  ".zitadel/idps/acme-sso.json already exists, so the display name you gave was not applied. Edit the file to change it.";

/**
 * A display name with an escape sequence in it.
 */
const HOSTILE_DISPLAY_NAME = "Ac\u001b[31mme";

/**
 * A provider `auth-method sso enable` can add, and the flags that ask for it.
 */
type Provider = {
  readonly name: string;
  readonly slug: string;
  readonly provider: string;
  readonly displayName: string;
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
  provider: GOOGLE,
  displayName: "Google",
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
  provider: "custom",
  displayName: ACME.displayName,
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

        it("reports the connection it wrote and where the credentials were stored", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: `${provider.displayName} sign-in is configured locally`,
              project_id: expect.stringMatching(/^proj-/),
              provider: provider.provider,
              schema: SCHEMA,
              connection: {
                action: "create",
                slug: provider.slug,
                file: `.zitadel/idps/${provider.slug}.json`,
                ...DEFAULT_CONNECTION,
              },
              callback_uri: `http://localhost:3000/__nextgen/idp/${provider.slug}/callback`,
              changed: [SCHEMA_FILE, FLOW_FILE, `.zitadel/idps/${provider.slug}.json`],
              notices: [],
              client_id: { variable: `${provider.variables}_CLIENT_ID`, published: "stored" },
              secret: { variable: `${provider.variables}_CLIENT_SECRET`, published: "stored" },
              next_args: [
                ["deploy", "--dry-run", "--server", MOCK_SERVER_URL, "--cwd", app.path],
                ["deploy", "-m", "<what changed>", "--server", MOCK_SERVER_URL, "--cwd", app.path],
              ],
              next_actions: [
                `Deploy it to make ${provider.displayName} sign-in available in your app, then reload the app and test it`,
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
                expectedPublicCliCommand(
                  `deploy -m '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
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
          it("reports that it is already configured, with nothing to deploy", async () => {
            const app = await anAppServing(provider);

            const result = await app.enableSsoWith(provider.flags, provider.credentials.secret);

            expect(JSON.parse(result.stdout)).toEqual({
              cli_version: cliVersion.version,
              command: "auth-method:sso:enable",
              source: MOCK_SERVER_URL,
              status: "ok",
              data: {
                title: `${provider.displayName} sign-in is already configured locally`,
                project_id: expect.stringMatching(/^proj-/),
                provider: provider.provider,
                schema: SCHEMA,
                connection: {
                  action: "reuse",
                  slug: provider.slug,
                  file: `.zitadel/idps/${provider.slug}.json`,
                  ...DEFAULT_CONNECTION,
                },
                callback_uri: `http://localhost:3000/__nextgen/idp/${provider.slug}/callback`,
                changed: [],
                notices: [],
                client_id: { variable: `${provider.variables}_CLIENT_ID`, published: "stored" },
                secret: { variable: `${provider.variables}_CLIENT_SECRET`, published: "stored" },
                next_args: [],
                next_commands: [],
              },
              warnings: [],
            });
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

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Google sign-in is already configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: GOOGLE,
              schema: SCHEMA,
              connection: {
                action: "reuse",
                slug: GOOGLE,
                file: ".zitadel/idps/google.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/google/callback",
              changed: [],
              notices: [],
              client_id: { variable: "GOOGLE_CLIENT_ID", published: "stored" },
              secret: { variable: "GOOGLE_CLIENT_SECRET", published: "stored" },
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
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

        it("is reported as left alone, once in the envelope", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(withOwnCopy);

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Google sign-in is configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: GOOGLE,
              schema: SCHEMA,
              connection: {
                action: "create",
                slug: GOOGLE,
                file: ".zitadel/idps/google.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/google/callback",
              changed: [SCHEMA_FILE, FLOW_FILE, ".zitadel/idps/google.json"],
              notices: [{ severity: "warning", message: HAND_EDITED_WARNING }],
              client_id: { variable: "GOOGLE_CLIENT_ID", published: "stored" },
              secret: { variable: "GOOGLE_CLIENT_SECRET", published: "stored" },
              next_args: [
                ["deploy", "--dry-run", "--server", MOCK_SERVER_URL, "--cwd", app.path],
                ["deploy", "-m", "<what changed>", "--server", MOCK_SERVER_URL, "--cwd", app.path],
              ],
              next_actions: [
                "Deploy it to make Google sign-in available in your app, then reload the app and test it",
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
                expectedPublicCliCommand(
                  `deploy -m '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [HAND_EDITED_WARNING],
          });
        });

        it("is reported as left alone, once on screen", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(withOwnCopy);

          const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

          expect(result).toSayOnce(HAND_EDITED_WARNING);
        });

        it("is not reported again once the developer has added the provider and its routes", async () => {
          const app = await aSetUpApp();
          await app.editPasswordStep(withOwnCopyAndGoogle);

          const result = await app.enableSso(GOOGLE, CREDENTIALS);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Google sign-in is configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: GOOGLE,
              schema: SCHEMA,
              connection: {
                action: "create",
                slug: GOOGLE,
                file: ".zitadel/idps/google.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/google/callback",
              changed: [SCHEMA_FILE, FLOW_FILE, ".zitadel/idps/google.json"],
              notices: [],
              client_id: { variable: "GOOGLE_CLIENT_ID", published: "stored" },
              secret: { variable: "GOOGLE_CLIENT_SECRET", published: "stored" },
              next_args: [
                ["deploy", "--dry-run", "--server", MOCK_SERVER_URL, "--cwd", app.path],
                ["deploy", "-m", "<what changed>", "--server", MOCK_SERVER_URL, "--cwd", app.path],
              ],
              next_actions: [
                "Deploy it to make Google sign-in available in your app, then reload the app and test it",
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
                expectedPublicCliCommand(
                  `deploy -m '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
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

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Acme SSO sign-in is already configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: "custom",
              schema: SCHEMA,
              connection: {
                action: "reuse",
                slug: ACME.slug,
                file: ".zitadel/idps/acme-sso.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/acme-sso/callback",
              changed: [],
              notices: [{ severity: "warning", message: SCOPES_NOT_APPLIED }],
              client_id: { variable: "ACME_SSO_CLIENT_ID", published: "stored" },
              secret: { variable: "ACME_SSO_CLIENT_SECRET", published: "stored" },
              next_args: [],
              next_commands: [],
            },
            warnings: [SCOPES_NOT_APPLIED],
          });
        });

        it("does not warn about scopes the developer did not pass this time", async () => {
          const app = await aSetUpApp();
          await app.hasEnabledCustomSso({ ...ACME, scopes: "openid groups" }, ACME_CREDENTIALS);

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Acme SSO sign-in is already configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: "custom",
              schema: SCHEMA,
              connection: {
                action: "reuse",
                slug: ACME.slug,
                file: ".zitadel/idps/acme-sso.json",
                ...DEFAULT_CONNECTION,
                scopes: ["openid", "groups"],
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/acme-sso/callback",
              changed: [],
              notices: [],
              client_id: { variable: "ACME_SSO_CLIENT_ID", published: "stored" },
              secret: { variable: "ACME_SSO_CLIENT_SECRET", published: "stored" },
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
        });

        it("warns when the display name differs", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(
            { ...ACME, displayName: "Acme staff" },
            ACME_CREDENTIALS,
          );

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Acme staff sign-in is already configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: "custom",
              schema: SCHEMA,
              connection: {
                action: "reuse",
                slug: ACME.slug,
                file: ".zitadel/idps/acme-sso.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/acme-sso/callback",
              changed: [],
              notices: [{ severity: "warning", message: DISPLAY_NAME_NOT_APPLIED }],
              client_id: { variable: "ACME_SSO_CLIENT_ID", published: "stored" },
              secret: { variable: "ACME_SSO_CLIENT_SECRET", published: "stored" },
              next_args: [],
              next_commands: [],
            },
            warnings: [DISPLAY_NAME_NOT_APPLIED],
          });
        });

        it("does not warn when nothing differs", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(ACME, ACME_CREDENTIALS);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Acme SSO sign-in is already configured locally",
              project_id: expect.stringMatching(/^proj-/),
              provider: "custom",
              schema: SCHEMA,
              connection: {
                action: "reuse",
                slug: ACME.slug,
                file: ".zitadel/idps/acme-sso.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/acme-sso/callback",
              changed: [],
              notices: [],
              client_id: { variable: "ACME_SSO_CLIENT_ID", published: "stored" },
              secret: { variable: "ACME_SSO_CLIENT_SECRET", published: "stored" },
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
        });
      });

      describe("a custom connection that would share a variable with another", () => {
        it("stops, naming both connections and the variable", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(
            { ...ACME, slug: "acme_sso", displayName: "Acme again" },
            ACME_CREDENTIALS,
          );

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_CONFLICT",
            message: ".zitadel/idps/acme-sso.json and acme_sso both use ACME_SSO_CLIENT_ID",
            hint: "Point one of them at a variable of its own, then run the command again.",
            details: {
              file: ".zitadel/idps/acme-sso.json",
              slug: "acme_sso",
              other_slug: "acme-sso",
              variable: "ACME_SSO_CLIENT_ID",
            },
          });
        });
      });

      describe("a custom connection under the name of one to another provider", () => {
        it("stops, naming both issuers", async () => {
          const app = await anAppWith(CUSTOM);

          const result = await app.enableCustomSso(
            { ...ACME, issuer: "https://sso.other.example" },
            ACME_CREDENTIALS,
          );

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_CONFLICT",
            message:
              ".zitadel/idps/acme-sso.json is already named acme-sso and connects to https://sso.acme.example, not https://sso.other.example",
            hint: "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
            details: {
              file: ".zitadel/idps/acme-sso.json",
              slug: "acme-sso",
              issuer: "https://sso.other.example",
              existing_issuer: "https://sso.acme.example",
            },
          });
        });
      });

      describe("a custom connection the command refuses", () => {
        it("names the slug flag to fix", async () => {
          const app = await aSetUpApp();

          const result = await app.enableCustomSso({ ...ACME, slug: GOOGLE }, ACME_CREDENTIALS);

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message:
              '--slug: "google" is a built-in provider. Choose another name for this connection.',
            hint: "Fix --slug and run the command again.",
            details: { flag: "--slug" },
          });
        });
      });

      describe("a provider the catalog does not list", () => {
        it("is refused before anything is asked", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(["--provider", "gogle", "--client-id", "a"], "s");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: "Expected --provider=gogle to be one of: google, custom",
            next_commands: [expectedPublicCliCommand("auth-method sso enable --help")],
            details: {
              original: {
                name: "Error",
                message:
                  "Expected --provider=gogle to be one of: google, custom\nSee more help with --help",
              },
            },
          });
        });
      });

      describe("a schema the project does not hold", () => {
        it("is refused, with its name as typed", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(
            [...GOOGLE_FLAGS, "--client-id", "a", "--schema", "no\u001b[31mpe"],
            "s",
          );

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_NOT_FOUND",
            message: "This project has no user schema named no\u001b[31mpe",
            hint: "Known schemas: default-human-user (human-user)",
            details: {
              requested: "no\u001b[31mpe",
              known: [SCHEMA],
              schemas: [{ name: SCHEMA, object_type: "human-user" }],
            },
          });
        });
      });

      describe("a connection named with an escape sequence", () => {
        it("keeps the name as typed in the envelope", async () => {
          const app = await aSetUpApp();

          const result = await app.enableCustomSso(
            { ...ACME, displayName: HOSTILE_DISPLAY_NAME },
            ACME_CREDENTIALS,
          );

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: `${HOSTILE_DISPLAY_NAME} sign-in is configured locally`,
              project_id: expect.stringMatching(/^proj-/),
              provider: "custom",
              schema: SCHEMA,
              connection: {
                action: "create",
                slug: ACME.slug,
                file: ".zitadel/idps/acme-sso.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/acme-sso/callback",
              changed: [SCHEMA_FILE, FLOW_FILE, ".zitadel/idps/acme-sso.json"],
              notices: [],
              client_id: { variable: "ACME_SSO_CLIENT_ID", published: "stored" },
              secret: { variable: "ACME_SSO_CLIENT_SECRET", published: "stored" },
              next_args: [
                ["deploy", "--dry-run", "--server", MOCK_SERVER_URL, "--cwd", app.path],
                ["deploy", "-m", "<what changed>", "--server", MOCK_SERVER_URL, "--cwd", app.path],
              ],
              next_actions: [
                `Deploy it to make ${HOSTILE_DISPLAY_NAME} sign-in available in your app, then reload the app and test it`,
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
                expectedPublicCliCommand(
                  `deploy -m '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });
      });

      describe("a catalog provider without a client secret", () => {
        it("is refused, with the command to run once it is to hand", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(
            [...GOOGLE_FLAGS, "--client-id", "a-client-id"],
            "",
          );

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: "No client secret for GOOGLE_CLIENT_SECRET supplied",
            hint: `Pipe it in on stdin. It is never a flag: that would put it in shell history, a process listing and CI logs. For example: printf '%s' "$CLIENT_SECRET" | ${expectedPublicCliCommand(`auth-method sso enable --provider google --client-id a-client-id --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
            next_commands: [
              `printf '%s' "$CLIENT_SECRET" | ${expectedPublicCliCommand(`auth-method sso enable --provider google --client-id a-client-id --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
            ],
          });
        });
      });

      describe("a catalog provider without a client id", () => {
        it("is refused, with the command to run once it is to hand", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(GOOGLE_FLAGS, "a-client-secret");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: "No client id for Google supplied",
            hint: `Pass --client-id. For example: ${expectedPublicCliCommand(`auth-method sso enable --provider google --client-id <client-id> --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
            next_commands: [
              expectedPublicCliCommand(
                `auth-method sso enable --provider google --client-id <client-id> --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          });
        });
      });

      describe("a custom connection without a client secret", () => {
        it("is refused, with no command to suggest for a name that needs quoting", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith([...ACME_FLAGS, "--client-id", "a-client-id"], "");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: "No client secret for ACME_SSO_CLIENT_SECRET supplied",
            hint: "Pipe it in on stdin. It is never a flag: that would put it in shell history, a process listing and CI logs.",
          });
        });
      });

      describe("a custom connection without a client id", () => {
        it("is refused, with no command to suggest for a name that needs quoting", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(ACME_FLAGS, "a-client-secret");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: "No client id for Acme SSO supplied",
            hint: "Pass --client-id.",
          });
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
          },
          {
            missing: "client id",
            args: flags,
            secret: "a-client-secret",
          },
        ];

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

      describe("under --dry-run", () => {
        it("previews what it would write and store, and the command that does", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(
            [...CATALOG.flags, "--dry-run"],
            CREDENTIALS.secret,
          );

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Would write .zitadel/schemas/default-human-user.json (dry run)",
              project_id: expect.stringMatching(/^proj-/),
              provider: GOOGLE,
              schema: SCHEMA,
              connection: {
                action: "create",
                slug: GOOGLE,
                file: ".zitadel/idps/google.json",
                ...DEFAULT_CONNECTION,
              },
              callback_uri: "http://localhost:3000/__nextgen/idp/google/callback",
              changed: [SCHEMA_FILE, FLOW_FILE, ".zitadel/idps/google.json"],
              notices: [],
              client_id: null,
              secret: null,
              would_store: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
              dry_run: true,
              next_args: [
                [
                  "auth-method",
                  "sso",
                  "enable",
                  "--provider",
                  GOOGLE,
                  "--client-id",
                  CREDENTIALS.clientId,
                  "--server",
                  MOCK_SERVER_URL,
                  "--cwd",
                  app.path,
                ],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method sso enable --provider ${GOOGLE} --client-id ${CREDENTIALS.clientId} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("writes no file", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.enableSsoWith([...CATALOG.flags, "--dry-run"], CREDENTIALS.secret);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("publishes no variable", async () => {
          const app = await aSetUpApp();

          await app.enableSsoWith([...CATALOG.flags, "--dry-run"], CREDENTIALS.secret);

          expect(await app.projectVariables()).toEqual([]);
        });

        it("keeps the secret out of its output", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(
            [...CATALOG.flags, "--dry-run"],
            CREDENTIALS.secret,
          );

          expect(result.stdout + result.stderr).not.toContain(CREDENTIALS.secret);
        });
      });

      describe("the secret", () => {
        it("stays out of everything the command prints as json", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(CATALOG.flags, CREDENTIALS.secret);

          expect(result.stdout + result.stderr).not.toContain(CREDENTIALS.secret);
        });

        it("stays out of the envelope of a refusal", async () => {
          const app = await aSetUpApp();

          const result = await app.enableSsoWith(
            [...GOOGLE_FLAGS, "--client-id", "a", "--schema", "nope"],
            CREDENTIALS.secret,
          );

          expect(result.stdout + result.stderr).not.toContain(CREDENTIALS.secret);
        });
      });

      describe("against a server that hangs", () => {
        it("stops on Ctrl-C", async () => {
          const app = await aSetUpApp();
          const waiting = platform.hangs();

          const result = app.enableSsoWith(CATALOG.flags, CREDENTIALS.secret);
          await waiting;
          pressCtrlC();

          expect(JSON.parse((await result).stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:enable",
            source: MOCK_SERVER_URL,
            code: "E_CANCELLED",
            message: "Cancelled",
            hint: "The command was cancelled with Ctrl-C.",
          });
        });

        it("exits 130 on Ctrl-C", async () => {
          const app = await aSetUpApp();
          const waiting = platform.hangs();

          const result = app.enableSsoWith(CATALOG.flags, CREDENTIALS.secret);
          await waiting;
          pressCtrlC();

          expect(await result).toExitWith(130);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says the provider is configured locally and not yet live", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("Google sign-in is configured locally");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrintNoJson();
      });

      it("draws a box that summarises the connection", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("When someone signs in with Google");
      });

      it("says what it configured, as the envelope titles it", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result.stdout.split("\n")).toContain("Google sign-in is configured locally");
      });

      it("says it is already configured when enabled again, as the envelope titles it", async () => {
        const app = await aSetUpApp();
        await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result.stdout.split("\n")).toContain("Google sign-in is already configured locally");
      });

      it("prints the callback URI to register with the provider", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint(
          "Callback URI   http://localhost:3000/__nextgen/idp/google/callback",
        );
      });

      it("names the files it wrote", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("Wrote .zitadel/idps/google.json");
      });

      it("says to deploy it, once", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toSayOnce(
          "Deploy it to make Google sign-in available in your app, then reload the app and test it",
        );
      });

      it("keeps the secret out of what it prints", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result.stdout + result.stderr).not.toContain(CREDENTIALS.secret);
      });

      it("says what it would do on a dry run, as the envelope titles it", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDryRun(GOOGLE, CREDENTIALS);

        expect(result.stdout.split("\n")).toContain(
          "Would write .zitadel/schemas/default-human-user.json (dry run)",
        );
      });

      it("keeps the secret out of what a dry run prints", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDryRun(GOOGLE, CREDENTIALS);

        expect(result.stdout + result.stderr).not.toContain(CREDENTIALS.secret);
      });

      it("spells out the escape sequence in a display name", async () => {
        const app = await aSetUpApp();

        const result = await app.pipingStdin(ACME_CREDENTIALS.secret, () => {
          return app.run([
            "auth-method",
            "sso",
            "enable",
            "--non-interactive",
            "--provider",
            "custom",
            "--slug",
            ACME.slug,
            "--display-name",
            HOSTILE_DISPLAY_NAME,
            "--issuer",
            ACME.issuer,
            "--client-id",
            ACME_CREDENTIALS.clientId,
          ]);
        });

        expect(result.stdout.split("\n")).toContain("Ac\\x1b[31mme sign-in is configured locally");
      });

      it("says on stderr that the client secret is missing", async () => {
        const app = await aSetUpApp();

        const result = await app.pipingStdin("", () => {
          return app.run([
            "auth-method",
            "sso",
            "enable",
            "--non-interactive",
            ...GOOGLE_FLAGS,
            "--client-id",
            CREDENTIALS.clientId,
          ]);
        });

        expect(result.stderr).toContain("No client secret for GOOGLE_CLIENT_SECRET supplied");
      });

      it("shows what the connection would map on a dry run", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDryRun(GOOGLE, CREDENTIALS);

        expect(result).toPrint("email comes from the provider's email claim");
      });

      it("shows the mapping a developer edited when enabled again, not a regenerated one", async () => {
        const app = await aSetUpApp();
        await app.enableSsoRendered(GOOGLE, CREDENTIALS);
        await app.editConnection("google", (connection) => {
          connection.claim_mapping = { email: "mail" };
        });

        const result = await app.enableSsoRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrint("email comes from the provider's mail claim");
      });
    });
  });
});
