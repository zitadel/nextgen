import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import {
  aCommittedApp,
  aMissingAppDirectory,
  aNewAppDirectory,
  anApp,
  type CliResult,
  type Credentials,
  type CustomConnection,
  PASSWORD_POLICY,
  type ScaffoldedApp,
  SETUP_ORIGIN,
} from "@tests/helpers/project";

const platform = usePlatformMock();

useLocalServers();

/**
 * The part of setup's envelope that says what it committed.
 */
type SetupGitData = {
  git: { initialized: boolean; commit: string | null };
};

/**
 * The part of setup's envelope that says what to do next.
 */
type NextActionsData = { next_actions: string[] };

/**
 * The part of setup's envelope that says which files it wrote.
 */
type FilesWrittenData = { files_written: string[] };

/**
 * A full commit sha.
 */
const SHA = /^[0-9a-f]{40}$/;

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

/**
 * The user schema setup writes and commits.
 */
const SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";

/**
 * The login flow setup writes.
 */
const FLOW_FILE = ".zitadel/flows/default-login.json";

/**
 * Google's client id and secret.
 */
const SOCIAL_CREDENTIALS: Credentials = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/**
 * The pages setup scaffolds into a Next.js app.
 */
const SCAFFOLDED_PAGES = ["app/login/page.tsx", "app/register/page.tsx", "app/profile/page.tsx"];

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
 * The flags describing the Acme connection, without a client id.
 */
const ACME_FLAGS = [
  "--sso",
  "custom",
  "--sso-slug",
  ACME.slug,
  "--sso-display-name",
  ACME.displayName,
  "--sso-issuer",
  ACME.issuer,
];

/**
 * The flags describing the Acme connection with its client id.
 */
const ACME_FLAGS_WITH_CLIENT_ID = [...ACME_FLAGS, "--sso-client-id", ACME_CREDENTIALS.clientId];

/**
 * The Acme connection's flags under a slug the server would refuse.
 */
const ACME_FLAGS_WITH_A_BAD_SLUG = ACME_FLAGS_WITH_CLIENT_ID.map((flag) => {
  return flag === ACME.slug ? "Acme" : flag;
});

/**
 * A provider setup can enable, with how to ask for it and what it publishes.
 */
type Provider = {
  readonly name: string;
  readonly slug: string;
  readonly variables: string;
  readonly credentials: Credentials;
  readonly setUp: (app: ScaffoldedApp) => Promise<CliResult>;
};

/**
 * The providers setup can enable.
 */
const PROVIDERS: readonly Provider[] = [
  {
    name: "a social provider",
    slug: "google",
    variables: "GOOGLE",
    credentials: SOCIAL_CREDENTIALS,
    setUp: (app) => {
      return app.setupWithSso("google", SOCIAL_CREDENTIALS);
    },
  },
  {
    name: "a custom OpenID Connect provider",
    slug: ACME.slug,
    variables: "ACME_SSO",
    credentials: ACME_CREDENTIALS,
    setUp: (app) => {
      return app.setupWithCustomSso(ACME, ACME_CREDENTIALS);
    },
  },
];

/**
 * The entries a list holds more than once.
 *
 * @param list - The list.
 * @returns Each repeated entry, once per repeat.
 */
function duplicatesIn(list: readonly string[]): string[] {
  return list.filter((entry, at) => {
    return list.indexOf(entry) !== at;
  });
}

describe("setup", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        const result = await app.setup();

        expect(result).toFailWith("E_NOT_FOUND");
      });

      it("does not claim to be configured", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        await app.setup();

        expect(await app.hasBeenConfigured()).toBe(false);
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

        const result = await app.setupSsoWith(ACME_FLAGS_WITH_A_BAD_SLUG, ACME_CREDENTIALS.secret);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("leaves the directory start ran in as it was", async () => {
        const app = await aNewAppDirectory();
        await app.startLocalServer();
        const before = await app.snapshot();
        platform.isUnavailable();

        await app.setupNewApp();

        expect(await before.changes()).toMatchObject(NO_CHANGES);
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
    it("holds its invariants in every rendering", async () => {
      const app = await anApp();
      platform.mintsAHostileProjectId();

      await app.inEveryRendering((how) => {
        return how.json ? app.setup([], {}, how.env) : app.setupRendered([], how.env);
      });
    });

    describe("--json", () => {
      it("succeeds", async () => {
        const app = await anApp();

        const result = await app.setup();

        expect(result).toSucceed();
      });

      it("scaffolds the login, register and profile pages", async () => {
        const app = await anApp();
        const before = await app.snapshot();

        await app.setup();

        expect((await before.changes()).added).toEqual(expect.arrayContaining(SCAFFOLDED_PAGES));
      });

      it.each(["business", "minimal"])(
        "scaffolds the pages for the %s use case",
        async (useCase) => {
          const app = await anApp();
          const before = await app.snapshot();

          await app.setup(["--use-case", useCase]);

          expect((await before.changes()).added).toEqual(expect.arrayContaining(SCAFFOLDED_PAGES));
        },
      );

      it("deploys what it wrote, so the first sign-in is served a release", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.liveDeploymentCount()).toBe(1);
      });

      it("registers the schema with the platform", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.publishedSchemas()).toHaveLength(1);
      });

      it("registers the flow with the platform", async () => {
        const app = await anApp();

        await app.setup();

        expect(await app.publishedFlows()).toHaveLength(1);
      });

      it("leaves nothing to reconcile", async () => {
        const app = await anApp();

        await app.setup();

        const data = await app.deployDryRunData();

        expect(data.diff?.files).toEqual([]);
      });

      it.each([
        "deploy -m '<what changed>'",
        "serves only what is deployed",
        "auth-method sso enable --provider google",
      ])("says %s in its next actions", async (said) => {
        const app = await anApp();

        const result = await app.setup();

        expect(app.envelopeOf<NextActionsData>(result).data.next_actions.join("\n")).toContain(
          said,
        );
      });

      it.each([SCHEMA_FILE, FLOW_FILE])("reports writing %s", async (file) => {
        const app = await anApp();

        const result = await app.setup();

        expect(app.envelopeOf<FilesWrittenData>(result).data.files_written).toContain(file);
      });

      it("reports each written file once", async () => {
        const app = await anApp();

        const result = await app.setup();

        expect(duplicatesIn(app.envelopeOf<FilesWrittenData>(result).data.files_written)).toEqual(
          [],
        );
      });

      describe("with git", () => {
        it("reports the commit it made", async () => {
          const app = await anApp();

          const result = await app.setup();

          expect(app.envelopeOf<SetupGitData>(result).data.git).toMatchObject({
            initialized: true,
            commit: expect.stringMatching(SHA),
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

          expect(await app.trackedFiles()).toContain(SCHEMA_FILE);
        });

        it("reports the repository it created when it could not commit", async () => {
          const app = await anApp();

          const result = await app.setupWithGitThatCannotCommit();

          expect(app.envelopeOf<SetupGitData>(result).data.git).toEqual({
            initialized: true,
            commit: null,
          });
        });

        it("warns that it could not commit and left a new repository", async () => {
          const app = await anApp();

          const result = await app.setupWithGitThatCannotCommit();

          expect(app.envelopeOf(result).warnings?.join("\n")).toContain(
            "Setup created a new, empty git repository here.",
          );
        });
      });

      describe("in an existing repository", () => {
        it("adds one commit on top of its history", async () => {
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
            commit: expect.stringMatching(SHA),
          });
        });

        it("refuses a detached HEAD, where its commit would be on no branch", async () => {
          const app = await anApp();
          await app.underVersionControl();
          await app.onADetachedHead();

          const result = await app.setup();

          expect(result).toFailWith("E_CONFLICT");
        });
      });

      describe("in a repository with uncommitted work", () => {
        it("refuses", async () => {
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

        it("writes nothing into the project", async () => {
          const app = await anApp();
          await app.underVersionControl();
          await app.withUncommittedWork();
          const before = await app.snapshot();

          await app.setup();

          expect(await before.changes()).toMatchObject(NO_CHANGES);
        });

        it("sets the project up anyway under --no-git", async () => {
          const app = await anApp();
          await app.underVersionControl();
          await app.withUncommittedWork();

          const result = await app.setup(["--no-git"]);

          expect(result).toSucceed();
        });
      });

      it("records no commit under --no-git", async () => {
        const app = await anApp();

        const result = await app.setup(["--no-git"]);

        expect(app.envelopeOf<SetupGitData>(result).data.git).toEqual({
          initialized: false,
          commit: null,
        });
      });

      describe("when it publishes the password policy", () => {
        it("publishes the recommended minimum length", async () => {
          const app = await anApp();

          await app.setup();

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY, config: { min_length: 15 } }),
          ]);
        });

        it("puts a given minimum length into the policy", async () => {
          const app = await anApp();

          await app.setup(["--password-min-length", "12"]);

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY, config: { min_length: 12 } }),
          ]);
        });

        it("reads a minimum length of 0 as none", async () => {
          const app = await anApp();

          await app.setup(["--password-min-length", "0"]);

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY, config: {} }),
          ]);
        });

        it("refuses a minimum length outside the bounds before creating anything", async () => {
          const app = await anApp();

          const result = await app.setup(["--password-min-length", "65"]);

          expect(result).toFailWith("E_VALIDATION");
        });
      });

      describe("in a directory without an app", () => {
        it("creates a new app in the directory start ran in", async () => {
          const app = await aNewAppDirectory();
          await app.startLocalServer();

          const result = await app.setupNewApp();

          expect(result).toSucceed();
        });

        it("creates a new app in a directory whose name is not a valid package name", async () => {
          const app = await aNewAppDirectory("Tmp.W4SK1wDYDb");

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

          expect(await before.changes()).toMatchObject(NO_CHANGES);
        });

        it("sets a new app up as new when rerun after a failed run", async () => {
          const app = await aNewAppDirectory();
          platform.isUnavailable();
          await app.setupNewApp();
          platform.recovers();

          const rerun = await app.setupNewApp();

          expect(app.envelopeOf<FilesWrittenData>(rerun).data.files_written).toContain(
            "app/page.tsx",
          );
        });
      });

      describe("with the install", () => {
        it("installs the dependencies it added", async () => {
          const app = await anApp();

          await app.setup([], { install: true });

          expect(await app.installInvocation()).toMatchObject({ args: ["install"] });
        });

        it("installs in the app's directory", async () => {
          const app = await anApp();

          await app.setup([], { install: true });

          expect(await app.installInvocation()).toMatchObject({ cwd: await app.realPath() });
        });

        it("keeps the package manager's own output off stdout", async () => {
          const app = await anApp();

          const result = await app.setup([], { install: true });

          expect(result).not.toPrint("fake npm stdout");
        });

        it("passes the package manager's own output on", async () => {
          const app = await anApp();

          const result = await app.setup([], { install: true });

          expect(result).toSay("fake npm stdout");
        });
      });

      describe("in an app below the supported framework version", () => {
        it("refuses", async () => {
          const app = await anApp({ nextVersion: "^14.2.0" });

          const result = await app.setup();

          expect(result).toFailWith("E_UNSUPPORTED_PROJECT_SHAPE");
        });

        it("says the version is below the supported floor", async () => {
          const app = await anApp({ nextVersion: "^14.2.0" });

          const result = await app.setup();

          expect(result).toExplain("below the supported floor");
        });

        it("writes nothing to the app", async () => {
          const app = await anApp({ nextVersion: "^14.2.0" });
          const before = await app.snapshot();

          await app.setup();

          expect(await before.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("on a rerun", () => {
        it("skips", async () => {
          const app = await aCommittedApp();

          const rerun = await app.setup();

          expect(rerun).toBeSkipped();
        });

        it("skips after the developer edited the schema", async () => {
          const app = await aCommittedApp();
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });

          const rerun = await app.setup();

          expect(rerun).toBeSkipped();
        });

        it("leaves the developer's edits in place", async () => {
          const app = await aCommittedApp();
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });

          await app.setup();

          const data = await app.deployDryRunData();

          expect(data.diff?.files).toEqual([
            expect.objectContaining({ patch: expect.stringContaining('"company"') }),
          ]);
        });

        it("replaces the previous origin when --dev-port moves the app with --force", async () => {
          const app = await aCommittedApp();

          await app.setup(["--dev-port", "3001", "--force"]);

          expect(await app.projectOrigins()).toEqual([
            { pattern: "http://localhost:3001", kind: "primary" },
          ]);
        });

        describe("with --dev-port, without --force, when no one can be asked", () => {
          it("still succeeds", async () => {
            const app = await aCommittedApp();

            const result = await app.setup(["--dev-port", "3001"]);

            expect(result).toSucceed();
          });

          it("says to pass --force", async () => {
            const app = await aCommittedApp();

            const result = await app.setup(["--dev-port", "3001"]);

            expect(result).toSay("origin rm http://localhost:3000 --force");
          });

          it("suggests removing the previous origin with --force", async () => {
            const app = await aCommittedApp();

            const result = await app.setup(["--dev-port", "3001"]);

            expect(result).toSuggestExactly(
              app.asSetupSuggests("origin rm http://localhost:3000 --force"),
            );
          });

          it("removes nothing", async () => {
            const app = await aCommittedApp();

            await app.setup(["--dev-port", "3001"]);

            expect(await app.projectOrigins()).toContainEqual(SETUP_ORIGIN);
          });
        });
      });

      describe("when its first deploy is refused", () => {
        it("succeeds", async () => {
          const app = await anApp();
          platform.rejectsASchema();

          const result = await app.setup();

          expect(result).toSucceed();
        });

        it("deploys nothing", async () => {
          const app = await anApp();
          platform.rejectsASchema();

          await app.setup();

          expect(await app.liveDeploymentCount()).toBe(0);
        });

        it("leaves what it wrote for deploy to publish", async () => {
          const app = await anApp();
          platform.rejectsASchema();

          await app.setup();

          platform.recovers();
          expect(await app.deploy()).toSucceed();
        });
      });

      it.each([
        { preset: "passkey-first", entersOn: "passkey-first" },
        { preset: "password-first", entersOn: "identifier" },
      ])("enters the $preset journey on $entersOn", async ({ preset, entersOn }) => {
        const app = await anApp();

        await app.setup(["--preset", preset]);

        expect((await app.publishedFlow()).flow_definition.purposes).toMatchObject({
          login: entersOn,
          register: "register",
        });
      });

      it.each([
        { preset: "passkey-first", method: "passkey" },
        { preset: "password-first", method: "password" },
      ])("enables $method for the $preset preset", async ({ preset, method }) => {
        const app = await anApp();

        await app.setup(["--preset", preset]);

        expect((await app.publishedSchema()).schema["x-auth-methods"]).toMatchObject({
          [method]: { enabled: true },
        });
      });

      describe.each(PROVIDERS)("with $name", (provider) => {
        it("succeeds", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          expect(result).toSucceed();
        });

        it("registers the connection under its slug", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(
            (await app.registeredIdps()).map((idp) => {
              return idp.slug;
            }),
          ).toEqual([provider.slug]);
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

        it("reports the scopes the connection asks for", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          const { data } = app.envelopeOf<{ sso: { scopes: string[] }[] }>(result);
          expect(data.sso[0]?.scopes).toEqual(["openid", "profile", "email"]);
        });

        it("reports the attributes no claim fills", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          const { data } = app.envelopeOf<{ sso: { unmapped: unknown[] }[] }>(result);
          expect(data.sso[0]?.unmapped).toEqual([]);
        });

        it("reports the schemas that sign in through the connection", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          const { data } = app.envelopeOf<{ sso: { used_by: string[] }[] }>(result);
          expect(data.sso[0]?.used_by).toEqual(["default-human-user"]);
        });

        it("publishes the client id as a readable project variable", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.projectVariables()).toContainEqual(
            expect.objectContaining({
              name: `${provider.variables}_CLIENT_ID`,
              value: provider.credentials.clientId,
            }),
          );
        });

        it("publishes the client secret as a secret", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.projectVariables()).toContainEqual(
            expect.objectContaining({ name: `${provider.variables}_CLIENT_SECRET`, secret: true }),
          );
        });

        it("publishes the client secret without its value", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.projectVariables()).not.toContainEqual(
            expect.objectContaining({
              name: `${provider.variables}_CLIENT_SECRET`,
              value: expect.anything(),
            }),
          );
        });

        it("commits a reference to the client id", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect((await app.committed.idpConnection(provider.slug)).oidc.client_id).toBe(
            `\${{ ${provider.variables}_CLIENT_ID }}`,
          );
        });

        it("commits a reference to the client secret", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect((await app.committed.idpConnection(provider.slug)).oidc.client_secret).toBe(
            `\${{ ${provider.variables}_CLIENT_SECRET }}`,
          );
        });

        it("keeps the secret out of every file in the project", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.filesContaining(provider.credentials.secret)).toEqual([]);
        });

        it("keeps the client id out of every file in the project", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.filesContaining(provider.credentials.clientId)).toEqual([]);
        });

        it("names the connection among the published auth methods", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect((await app.publishedSchema()).schema["x-auth-methods"]?.sso).toEqual({
            enabled: true,
            providers: [provider.slug],
          });
        });

        it("offers the connection on the steps a sign-in starts from", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(
            (await app.stepsOfferingSso()).map((step) => {
              return step.name;
            }),
          ).toEqual(expect.arrayContaining(["identifier", "register"]));
        });

        it("offers the connection on the conflict step too", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(
            (await app.stepsOfferingSso()).map((step) => {
              return step.name;
            }),
          ).toContain("sso-conflict");
        });

        it("offers only the connection on every step that offers one", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.stepsOfferingSso()).not.toContainEqual(
            expect.not.objectContaining({ sso_providers: [provider.slug] }),
          );
        });

        it("says where each offering step returns from the provider", async () => {
          const app = await anApp();

          await provider.setUp(app);

          expect(await app.stepsOfferingSso()).not.toContainEqual(
            expect.not.objectContaining({
              transitions: expect.objectContaining({ sso_authenticated: expect.anything() }),
            }),
          );
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anApp();

          await provider.setUp(app);

          const data = await app.deployDryRunData();

          expect(data.diff?.files).toEqual([]);
        });
      });

      describe("rendered for a terminal", () => {
        it("heads the connection's box with the provider", async () => {
          const app = await anApp();

          const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

          expect(result).toPrint("SIGN IN WITH ACME SSO");
        });

        it("says which claim fills each attribute", async () => {
          const app = await anApp();

          const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

          expect(result).toPrint("- email comes from the email claim.");
        });

        it("says which schemas sign in through the connection", async () => {
          const app = await anApp();

          const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

          expect(result).toPrint("default-human-user signs in");
        });
      });

      describe("with a custom provider but not both credentials", () => {
        it("will not set up the provider without a client secret", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(ACME_FLAGS_WITH_CLIENT_ID, "");

          expect(result).toFailWith("E_VALIDATION");
        });

        it("names the secret as what is missing", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(ACME_FLAGS_WITH_CLIENT_ID, "");

          expect(result).toExplain("No client secret supplied");
        });

        it("hints at piping the secret in", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(ACME_FLAGS_WITH_CLIENT_ID, "");

          expect(result).toHintAt("Pipe it in on stdin.");
        });

        it.each([`printf '%s' "$CLIENT_SECRET" | `, "setup --sso custom --sso-client-id <id>"])(
          "suggests piping the secret in, without carrying one: %s",
          async (suggested) => {
            const app = await anApp();

            const result = await app.setupSsoWith(ACME_FLAGS_WITH_CLIENT_ID, "");

            expect(result).toSuggest(suggested);
          },
        );

        it("will not set up the provider without a client id", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(ACME_FLAGS, ACME_CREDENTIALS.secret);

          expect(result).toExplain("--sso-client-id");
        });

        it.each([
          ["a client secret", ACME_FLAGS_WITH_CLIENT_ID, ""],
          ["a client id", ACME_FLAGS, ACME_CREDENTIALS.secret],
        ])("writes nothing when it is refused for want of %s", async (_missing, args, secret) => {
          const app = await anApp();
          const before = await app.snapshot();

          await app.setupSsoWith(args, secret);

          expect(await before.changes()).toMatchObject(NO_CHANGES);
        });
      });
    });
  });
});
