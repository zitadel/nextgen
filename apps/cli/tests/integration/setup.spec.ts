import { realpath } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { useLocalServers } from "../helpers/local-server";
import { usePlatformMock } from "../helpers/platform";
import {
  aMissingAppDirectory,
  aNewAppDirectory,
  anApp,
  type ScaffoldedApp,
  PASSWORD_POLICY,
} from "../helpers/project";

const platform = usePlatformMock();

/** The part of setup's envelope that says what it committed and published. */
type SetupGitData = {
  git: { initialized: boolean; commit: string | null };
};
useLocalServers();

const SOCIAL_CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

const SCAFFOLDED_PAGES = ["app/login/page.tsx", "app/register/page.tsx", "app/profile/page.tsx"];

const ACME = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};
const ACME_CREDENTIALS = { clientId: "acme-client-id", secret: "acme-client-secret" };

/** The providers setup can enable, with how to ask for each and what it publishes. */
const PROVIDERS = [
  {
    name: "a social provider",
    slug: "google",
    variables: "GOOGLE",
    credentials: SOCIAL_CREDENTIALS,
    setUp: (app: ScaffoldedApp) => app.setupWithSso("google", SOCIAL_CREDENTIALS),
  },
  {
    name: "a custom OpenID Connect provider",
    slug: "acme-sso",
    variables: "ACME_SSO",
    credentials: ACME_CREDENTIALS,
    setUp: (app: ScaffoldedApp) => app.setupWithCustomSso(ACME, ACME_CREDENTIALS),
  },
];

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

      it("still names a custom connection flag that is wrong", async () => {
        const app = await anApp();
        platform.isUnavailable();

        const result = await app.setupSsoWith(
          [
            "--sso",
            "custom",
            "--sso-slug",
            "Acme",
            "--sso-display-name",
            "Acme SSO",
            "--sso-issuer",
            "https://sso.acme.example",
            "--sso-client-id",
            "acme-client-id",
          ],
          "acme-client-secret",
        );

        expect(result).toFailWith("E_VALIDATION");
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
      it("publishes nothing, leaving the deploy to the developer", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.liveDeploymentCount()).toBe(0);
      });

      it("names the deploy that publishes what it wrote", async () => {
        const app = await anApp();

        const result = await app.setup();

        expect(
          app.envelopeOf<{ next_actions: string[] }>(result).data.next_actions.join("\n"),
        ).toContain("deploy -m '<what changed>'");
      });

      it("says the configuration is not live yet", async () => {
        const app = await anApp();

        const result = await app.setup();

        expect(
          app.envelopeOf<{ next_actions: string[] }>(result).data.next_actions.join("\n"),
        ).toContain("Nothing is released yet");
      });

      it("reports the commit it made", async () => {
        const app = await anApp();

        const result = await app.setup();

        expect(app.envelopeOf<SetupGitData>(result).data.git).toMatchObject({
          initialized: true,
          commit: expect.stringMatching(/^[0-9a-f]{40}$/),
        });
      });

      it("keeps the project secret it wrote out of the commit it makes", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.trackedFiles()).not.toContain(".zitadel/secret");
      });

      it.each([".env.development.local", ".env.local", ".env"])(
        "keeps %s out of the commit it makes",
        async (name) => {
          const app = await anApp();

          await app.setup();

          expect(await app.trackedFiles()).not.toContain(name);
        },
      );

      it("commits the configuration it wrote, which the release is built from", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.trackedFiles()).toContain(".zitadel/schemas/default-human-user.json");
      });

      it("adds one commit on top of an existing repository's history", async () => {
        const app = await anApp();
        await app.underVersionControl();

        await app.setup();

        expect(await app.commitSubjects()).toHaveLength(2);
      });

      it("reports that it committed without having made the repository", async () => {
        const app = await anApp();
        await app.underVersionControl();

        const result = await app.setup();

        expect(app.envelopeOf<SetupGitData>(result).data.git).toMatchObject({
          initialized: false,
          commit: expect.stringMatching(/^[0-9a-f]{40}$/),
        });
      });

      it("refuses a repository with uncommitted work", async () => {
        const app = await anApp();
        await app.underVersionControl();
        await app.withUncommittedWork();

        const result = await app.setup();

        expect(result).toFailWith("E_CONFLICT");
      });

      it("names the untracked file it refused over", async () => {
        const app = await anApp();
        await app.underVersionControl();
        await app.withUncommittedWork();

        const result = await app.setup();

        expect(result).toExplain("untracked file");
      });

      it("writes nothing into a project it refuses", async () => {
        const app = await anApp();
        await app.underVersionControl();
        await app.withUncommittedWork();
        const before = await app.snapshot();

        await app.setup();

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("sets up a dirty repository anyway under --no-git", async () => {
        const app = await anApp();
        await app.underVersionControl();
        await app.withUncommittedWork();

        const result = await app.setup(["--no-git"]);

        expect(result).toSucceed();
      });

      it("records no commit under --no-git", async () => {
        const app = await anApp();

        const result = await app.setup(["--no-git"]);

        expect(app.envelopeOf<SetupGitData>(result).data.git).toEqual({
          initialized: false,
          commit: null,
        });
      });

      it("scaffolds the project", async () => {
        const app = await anApp();
        const before = await app.snapshot();

        const result = await app.setup();

        expect(result).toSucceed();
        expect((await before.changes()).added).toEqual(expect.arrayContaining(SCAFFOLDED_PAGES));
      });

      it("publishes a password policy with the recommended minimum length", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.publishedPolicies()).toEqual([
          expect.objectContaining({ operation: PASSWORD_POLICY, config: { min_length: 15 } }),
        ]);
      });

      it("puts a given minimum password length into the policy", async () => {
        const app = await anApp();

        await app.setup(["--password-min-length", "12"]);

        expect(await app.publishedPolicies()).toEqual([
          expect.objectContaining({ operation: PASSWORD_POLICY, config: { min_length: 12 } }),
        ]);
      });

      it("reads a minimum password length of 0 as none", async () => {
        const app = await anApp();

        await app.setup(["--password-min-length", "0"]);

        expect(await app.publishedPolicies()).toEqual([
          expect.objectContaining({ operation: PASSWORD_POLICY, config: {} }),
        ]);
      });

      it("refuses a minimum password length outside the bounds before creating anything", async () => {
        const app = await anApp();

        const result = await app.setup(["--password-min-length", "65"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("creates a new app in the directory start ran in", async () => {
        const app = await aNewAppDirectory();
        await app.startLocalServer();

        const result = await app.setupNewApp();

        expect(result).toSucceed();
      });

      it("creates a new app in a directory that does not exist yet", async () => {
        const app = await aMissingAppDirectory();

        const result = await app.setupNewApp();

        expect(result).toSucceed();
      });

      it("previews a new app on a dry run", async () => {
        const app = await aNewAppDirectory();

        const result = await app.setupNewApp(["--dry-run"]);

        expect(result).toSucceed();
      });

      it("creates no app on a dry run", async () => {
        const app = await aNewAppDirectory();
        const before = await app.snapshot();

        await app.setupNewApp(["--dry-run"]);

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it.each([
        ["the platform is down", () => platform.isUnavailable()],
        ["the schema upload fails", () => platform.rejectsSchemaUploads()],
      ])("leaves the directory start ran in as it was when %s", async (_failure, fail) => {
        const app = await aNewAppDirectory();
        await app.startLocalServer();
        const before = await app.snapshot();
        fail();

        await app.setupNewApp();

        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("sets a new app up as new when rerun after a failed run", async () => {
        const app = await aNewAppDirectory();
        platform.isUnavailable();
        await app.setupNewApp();
        platform.recovers();

        const rerun = await app.setupNewApp();

        const { data } = app.envelopeOf<{ files_written: string[] }>(rerun);
        expect(data.files_written).toContain("app/page.tsx");
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

        expect(await app.deployDryRun()).toSucceed();
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

        expect(await app.deployDryRun()).toSucceed();
      });

      it("does not claim to be configured after a failed run", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        expect(await app.setup()).toFail();

        expect(await app.hasBeenConfigured()).toBe(false);
      });

      it("rolls back the credential env file a failed run created", async () => {
        const app = await anApp();
        platform.rejectsSchemaUploads();

        expect(await app.setup()).toFail();

        // setup created `.env.development.local` with the project it had to
        // abandon; the rollback removes it so a rerun does not inherit the
        // abandoned project's id (`merge-env` only adds missing keys).
        await expect(app.readProjectFile(".env.development.local")).rejects.toThrow();
      });

      it("lets a rerun finish what a failed run started", async () => {
        const app = await anApp();
        platform.rejectsSchemaUploads();
        expect(await app.setup()).toFail();
        platform.recovers();

        expect(await app.setup(["--force"])).toSucceed();

        expect(await app.deployDryRun()).toSucceed();
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

      describe.each(PROVIDERS)("with $name", (provider) => {
        it("registers the connection under its slug", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          expect(result).toSucceed();
          expect((await app.registeredIdps()).map((idp) => idp.slug)).toEqual([provider.slug]);
        });

        it("reports the claim mapping the connection was written with", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          const { data } = app.envelopeOf<{ sso: { claim_mapping: Record<string, string> }[] }>(
            result,
          );
          expect(data.sso[0]?.claim_mapping).toEqual({ email: "email" });
        });

        it("reports what makes the email verified apart from the mapping", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          const { data } = app.envelopeOf<{ sso: { verified_claims: Record<string, string> }[] }>(
            result,
          );
          expect(data.sso[0]?.verified_claims).toEqual({ email: "email_verified" });
        });

        it("reports that the connection reached the server", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          const { data } = app.envelopeOf<{ sso: { state: string }[] }>(result);
          expect(data.sso[0]?.state).toBe("applied");
        });

        it("publishes the client id as a readable project variable", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

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
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          const published = await app.projectVariables();

          const held = published.find(
            (variable) => variable.name === `${provider.variables}_CLIENT_SECRET`,
          );
          expect(held).toMatchObject({ secret: true });
          expect(held).not.toHaveProperty("value");
        });

        it("commits a reference to the client id", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          const connection = await app.committed.idpConnection(provider.slug);

          expect(connection.oidc.client_id).toBe(`\${{ ${provider.variables}_CLIENT_ID }}`);
        });

        it("commits a reference to the client secret", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          const connection = await app.committed.idpConnection(provider.slug);

          expect(connection.oidc.client_secret).toBe(`\${{ ${provider.variables}_CLIENT_SECRET }}`);
        });

        it("keeps the secret out of every file in the project", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          expect(await app.filesContaining(provider.credentials.secret)).toEqual([]);
        });

        it("keeps the client id out of every file in the project", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          expect(await app.filesContaining(provider.credentials.clientId)).toEqual([]);
        });

        it("names the connection among the published auth methods", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.sso).toEqual({
            enabled: true,
            providers: [provider.slug],
          });
        });

        it("offers the connection on the steps a sign-in starts from", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).toEqual(
            expect.arrayContaining(["identifier", "register"]),
          );
        });

        it("offers the connection on the conflict step too", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          const offering = await app.stepsOfferingSso();

          expect(offering.map((step) => step.name)).toContain("sso-conflict");
        });

        it("offers only the connection on every step that offers one", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          for (const step of await app.stepsOfferingSso()) {
            expect(step.sso_providers, step.name).toEqual([provider.slug]);
          }
        });

        it("says where each offering step returns from the provider", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          for (const step of await app.stepsOfferingSso()) {
            expect(Object.keys(step.transitions ?? {}), step.name).toContain("sso_authenticated");
          }
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anApp();
          expect(await provider.setUp(app)).toSucceed();

          expect(await app.deployDryRun()).toSucceed();
        });
      });

      describe("rendered for a terminal", () => {
        it("ends with a box that summarises the connection", async () => {
          const app = await anApp();

          const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

          expect(result).toPrint("SIGN IN WITH ACME SSO");
        });
      });

      describe("with a custom provider but not both credentials", () => {
        const flags = [
          "--sso",
          "custom",
          "--sso-slug",
          "acme-sso",
          "--sso-display-name",
          "Acme SSO",
          "--sso-issuer",
          "https://sso.acme.example",
        ];

        it("will not set up the provider without a client secret", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(
            [...flags, "--sso-client-id", "acme-client-id"],
            "",
          );

          expect(result).toFailWith("E_VALIDATION");
        });

        it("names the secret as what is missing", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(
            [...flags, "--sso-client-id", "acme-client-id"],
            "",
          );

          expect(result).toExplain("No client secret supplied");
          expect(result).toHintAt("Pipe it in on stdin.");
        });

        it("suggests piping the secret in, without carrying one", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(
            [...flags, "--sso-client-id", "acme-client-id"],
            "",
          );

          expect(result).toSuggest(`printf '%s' "$CLIENT_SECRET" | `);
          expect(result).toSuggest("setup --sso custom --sso-client-id <id>");
        });

        it("will not set up the provider without a client id", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(flags, "acme-client-secret");

          expect(result).toExplain("--sso-client-id");
        });

        it.each([
          ["a client secret", [...flags, "--sso-client-id", "acme-client-id"], ""],
          ["a client id", flags, "acme-client-secret"],
        ])("writes nothing when it is refused for want of %s", async (_missing, args, secret) => {
          const app = await anApp();
          const before = await app.snapshot();

          await app.setupSsoWith(args, secret);

          expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        });
      });
    });
  });
});
