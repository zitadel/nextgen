import { describe, expect, it } from "vitest";

import { SVELTEKIT_GITIGNORE } from "@tests/helpers/gitignore";
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
  DEFAULT_SIGNUP_POLICY,
  MOCK_SERVER_URL,
  PASSWORD_POLICY,
  type ScaffoldedApp,
  SETUP_ORIGIN,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

useLocalServers();

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
 * The headline of a setup.
 */
const SET_UP_TITLE = "Set up Zitadel in this app";

/**
 * The headline of a setup previewed.
 */
const WOULD_SET_UP_TITLE = "Would set up Zitadel in this app (dry run)";

/**
 * The project setup created, as it names it.
 */
const PROJECT = { project_id: expect.stringMatching(/^proj-/), issuer: "http://localhost:3000" };

/**
 * The install a run that did not install reports.
 */
const INSTALL_SKIPPED = {
  status: "skipped",
  package_manager: "npm",
  command: "npm install",
  reason: "skip-install",
};

/**
 * The commit a run that made one reports.
 */
const COMMITTED = { initialized: true, commit: expect.stringMatching(SHA) };

/**
 * How people sign in after a default setup.
 */
const SIGN_IN = {
  starts_with: "password",
  methods: ["password", "passkey"],
  fields: [{ name: "email", required: true }],
  password_min_length: 15,
  providers: [],
};

/**
 * What the first deploy reports, which only its ids vary.
 */
const DEPLOYMENT = {
  release_id: expect.stringMatching(/^rel_/),
  content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
  deployment_id: expect.stringMatching(/^dep_/),
  origins: ["http://localhost:3000"],
};

/**
 * The step that tells the developer how to check sign-in works.
 */
const VERIFY_STEP =
  "Verify auth in the browser: register a user, sign out, sign in again with the same user, and confirm /profile shows Signed in.";

/**
 * The step that points at the folders the developer edits.
 */
const CUSTOMIZE_STEP =
  "Customize what you ask for and how people sign in: edit .zitadel/schemas/ to change the information you collect, and .zitadel/flows/ to change the sign-up/sign-in experience. Each folder has a README with examples.";

/**
 * The step that says where the login's look is changed.
 */
/**
 * The step on changing the login's look, which names `branding eject` in the
 * directory setup ran in.
 *
 * @param app - The app setup ran in.
 * @returns The step.
 */
function brandingStep(app: { readonly path: string }): string {
  return `Change how the login looks: it is a component in your app, so theme it with --zl-* custom properties in your own stylesheet and build any page layout around it in your code. To change the widget's structure, ${expectedPublicCliCommand(`branding eject --cwd ${app.path}`)} scaffolds an editable template in .zitadel/branding/.`;
}

/**
 * Every file setup writes into an app, in the order it reports them.
 */
const FILES_WRITTEN = [
  ".gitignore",
  ".zitadel/secret",
  "zitadel.json",
  ".env.example",
  ".env.local",
  ".env.development.local",
  ".zitadel/state.json",
  "AGENTS.md",
  "README.md",
  "app/login/page.tsx",
  "app/register/page.tsx",
  "app/profile/page.tsx",
  "proxy.ts",
  "custom-elements.d.ts",
  "package.json",
  ".zitadel/meta/flow-definition.json",
  ".zitadel/meta/user-schema.json",
  ".zitadel/meta/user-property.json",
  ".zitadel/meta/property-name.json",
  ".zitadel/meta/auth-methods.json",
  ".zitadel/meta/auth-method.json",
  ".zitadel/meta/sso-auth-method.json",
  ".zitadel/meta/idp-connection.json",
  ".zitadel/meta/branding.json",
  ".zitadel/meta/policy.json",
  ".zitadel/meta/policy-test.json",
  ".zitadel/meta/project.json",
  ".zitadel/schemas/default-human-user.json",
  ".zitadel/flows/default-login.json",
  ".zitadel/policies/auth.factor.password.set.json",
  ".zitadel/policies/user.create.json",
  ".zitadel/schemas/README.md",
  ".zitadel/flows/README.md",
  ".zitadel/policies/README.md",
];

/**
 * The same, less the sign-up policy a server that predates it cannot take.
 */
const FILES_WRITTEN_WITHOUT_SIGNUP_POLICY = FILES_WRITTEN.filter((file) => {
  return file !== ".zitadel/policies/user.create.json";
});

/**
 * The files a dry run says it would write: the configuration is left to the real run.
 */
const FILES_WOULD_WRITE = [
  ".gitignore",
  ".zitadel/secret",
  "zitadel.json",
  ".env.example",
  ".env.local",
  ".env.development.local",
  ".zitadel/state.json",
  "AGENTS.md",
  "README.md",
  "app/login/page.tsx",
  "app/register/page.tsx",
  "app/profile/page.tsx",
  "proxy.ts",
  "custom-elements.d.ts",
  "package.json",
  ".zitadel/meta/flow-definition.json",
  ".zitadel/meta/user-schema.json",
  ".zitadel/meta/user-property.json",
  ".zitadel/meta/property-name.json",
  ".zitadel/meta/auth-methods.json",
  ".zitadel/meta/auth-method.json",
  ".zitadel/meta/sso-auth-method.json",
  ".zitadel/meta/idp-connection.json",
  ".zitadel/meta/branding.json",
  ".zitadel/meta/policy.json",
  ".zitadel/meta/policy-test.json",
  ".zitadel/meta/project.json",
];

/**
 * The scaffolded files, one row each, as the envelope types them.
 */
const FILES = [
  { path: ".zitadel", kind: "dir", action: "create" },
  { path: ".zitadel/flows", kind: "dir", action: "create" },
  { path: ".zitadel/schemas", kind: "dir", action: "create" },
  { path: ".gitignore", kind: "file", action: "update" },
  { path: ".zitadel/secret", kind: "file", action: "create" },
  { path: "zitadel.json", kind: "file", action: "create" },
  { path: ".env.example", kind: "file", action: "create" },
  { path: ".env.local", kind: "file", action: "create" },
  { path: ".env.development.local", kind: "file", action: "create" },
  { path: ".zitadel/state.json", kind: "file", action: "create" },
  { path: "AGENTS.md", kind: "file", action: "create" },
  { path: "README.md", kind: "file", action: "create" },
  { path: "app/login/page.tsx", kind: "file", action: "create" },
  { path: "app/register/page.tsx", kind: "file", action: "create" },
  { path: "app/profile/page.tsx", kind: "file", action: "create" },
  { path: "proxy.ts", kind: "file", action: "create" },
  { path: "custom-elements.d.ts", kind: "file", action: "create" },
  { path: "package.json", kind: "file", action: "update" },
  { path: ".zitadel/meta", kind: "dir", action: "create" },
  { path: ".zitadel/meta/flow-definition.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/user-schema.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/user-property.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/property-name.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/auth-methods.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/auth-method.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/sso-auth-method.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/idp-connection.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/branding.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/policy.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/policy-test.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/project.json", kind: "file", action: "create" },
];

/**
 * Every file setup writes into an app it creates.
 */
const NEW_APP_FILES_WRITTEN = [
  ".gitignore",
  ".zitadel/secret",
  "zitadel.json",
  ".env.example",
  ".env.local",
  ".env.development.local",
  ".zitadel/state.json",
  "AGENTS.md",
  "README.md",
  "app/page.tsx",
  "app/login/page.tsx",
  "app/register/page.tsx",
  "app/profile/page.tsx",
  "app/login/layout.tsx",
  "app/register/layout.tsx",
  "app/profile/layout.tsx",
  "proxy.ts",
  "custom-elements.d.ts",
  "package.json",
  ".zitadel/meta/flow-definition.json",
  ".zitadel/meta/user-schema.json",
  ".zitadel/meta/user-property.json",
  ".zitadel/meta/property-name.json",
  ".zitadel/meta/auth-methods.json",
  ".zitadel/meta/auth-method.json",
  ".zitadel/meta/sso-auth-method.json",
  ".zitadel/meta/idp-connection.json",
  ".zitadel/meta/branding.json",
  ".zitadel/meta/policy.json",
  ".zitadel/meta/policy-test.json",
  ".zitadel/meta/project.json",
  ".zitadel/schemas/default-human-user.json",
  ".zitadel/flows/default-login.json",
  ".zitadel/policies/auth.factor.password.set.json",
  ".zitadel/policies/user.create.json",
  ".zitadel/schemas/README.md",
  ".zitadel/flows/README.md",
  ".zitadel/policies/README.md",
];

/**
 * The scaffolded files of an app setup creates, one row each.
 */
const NEW_APP_FILES = [
  { path: ".zitadel", kind: "dir", action: "create" },
  { path: ".zitadel/flows", kind: "dir", action: "create" },
  { path: ".zitadel/schemas", kind: "dir", action: "create" },
  { path: ".gitignore", kind: "file", action: "update" },
  { path: ".zitadel/secret", kind: "file", action: "create" },
  { path: "zitadel.json", kind: "file", action: "create" },
  { path: ".env.example", kind: "file", action: "create" },
  { path: ".env.local", kind: "file", action: "create" },
  { path: ".env.development.local", kind: "file", action: "create" },
  { path: ".zitadel/state.json", kind: "file", action: "create" },
  { path: "AGENTS.md", kind: "file", action: "create" },
  { path: "README.md", kind: "file", action: "create" },
  { path: "app/page.tsx", kind: "file", action: "update" },
  { path: "app/login/page.tsx", kind: "file", action: "create" },
  { path: "app/register/page.tsx", kind: "file", action: "create" },
  { path: "app/profile/page.tsx", kind: "file", action: "create" },
  { path: "app/login/layout.tsx", kind: "file", action: "create" },
  { path: "app/register/layout.tsx", kind: "file", action: "create" },
  { path: "app/profile/layout.tsx", kind: "file", action: "create" },
  { path: "proxy.ts", kind: "file", action: "create" },
  { path: "custom-elements.d.ts", kind: "file", action: "create" },
  { path: "package.json", kind: "file", action: "update" },
  { path: ".zitadel/meta", kind: "dir", action: "create" },
  { path: ".zitadel/meta/flow-definition.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/user-schema.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/user-property.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/property-name.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/auth-methods.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/auth-method.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/sso-auth-method.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/idp-connection.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/branding.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/policy.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/policy-test.json", kind: "file", action: "create" },
  { path: ".zitadel/meta/project.json", kind: "file", action: "create" },
];

/**
 * A provider setup can enable, with how to ask for it and what it publishes.
 */
type Provider = {
  readonly name: string;
  readonly selection: string;
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
    selection: "google",
    slug: "google",
    variables: "GOOGLE",
    credentials: SOCIAL_CREDENTIALS,
    setUp: (app) => {
      return app.setupWithSso("google", SOCIAL_CREDENTIALS);
    },
  },
  {
    name: "a custom OpenID Connect provider",
    selection: "custom",
    slug: ACME.slug,
    variables: "ACME_SSO",
    credentials: ACME_CREDENTIALS,
    setUp: (app) => {
      return app.setupWithCustomSso(ACME, ACME_CREDENTIALS);
    },
  },
];

describe("setup", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await anApp();
        platform.isNotZitadel();

        const result = await app.setup();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "setup",
          source: MOCK_SERVER_URL,
          code: "E_NOT_FOUND",
          message: `POST ${MOCK_SERVER_URL}/api/v1/projects returned 404 — ${MOCK_SERVER_URL}/api/v1/projects has no such endpoint; is this a Zitadel platform API?`,
          hint: `If you meant to use a local Zitadel server, start it first and retry setup with the commands below.`,
          next_commands: [
            expectedPublicCliCommand(`start --cwd ${app.path}`),
            expectedPublicCliCommand(
              `setup --framework next --dev-port 3000 --server local --cwd ${app.path}`,
            ),
          ],
          details: {
            server: MOCK_SERVER_URL,
            original: {
              status: 404,
              url: `${MOCK_SERVER_URL}/api/v1/projects`,
              body: { raw: "<html>not here</html>" },
            },
          },
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "setup",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: "down",
          hint: `If you meant to use a local Zitadel server, start it first and retry setup with the commands below.`,
          next_commands: [
            expectedPublicCliCommand(`start --cwd ${app.path}`),
            expectedPublicCliCommand(
              `setup --framework next --dev-port 3000 --server local --cwd ${app.path}`,
            ),
          ],
          details: {
            server: MOCK_SERVER_URL,
            original: {
              status: 503,
              url: `${MOCK_SERVER_URL}/api/v1/projects`,
              body: { code: "unavailable", message: "down" },
            },
          },
        });
      });

      it("still names a custom connection flag that is wrong", async () => {
        const app = await anApp();
        platform.isUnavailable();

        const result = await app.setupSsoWith(ACME_FLAGS_WITH_A_BAD_SLUG, ACME_CREDENTIALS.secret);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "setup",
          source: "",
          code: "E_VALIDATION",
          message:
            '--sso-slug: Use lowercase letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.',
          hint: "Fix --sso-slug and run the command again.",
          details: { flag: "--sso-slug" },
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "setup",
          source: MOCK_SERVER_URL,
          code: "E_NETWORK",
          message: `POST ${MOCK_SERVER_URL}/api/v1/projects got no response`,
          hint: `Check your connection and the server URL (ZITADEL_URL or --server). If you meant to use a local Zitadel server, start it first and retry setup with the commands below.`,
          next_commands: [
            expectedPublicCliCommand(`start --cwd ${app.path}`),
            expectedPublicCliCommand(
              `setup --framework next --dev-port 3000 --server local --cwd ${app.path}`,
            ),
          ],
          details: {
            server: MOCK_SERVER_URL,
            original: { url: `${MOCK_SERVER_URL}/api/v1/projects`, reason: "unreachable" },
          },
        });
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
      it("reports what it wrote, deployed and suggests next", async () => {
        const app = await anApp();

        const result = await app.setup();

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "setup",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: SET_UP_TITLE,
            project: PROJECT,
            framework: "next",
            server: MOCK_SERVER_URL,
            files_written: FILES_WRITTEN,
            files: FILES,
            files_skipped: [],
            install: INSTALL_SKIPPED,
            git: COMMITTED,
            sign_in: SIGN_IN,
            sso: [],
            deployment: DEPLOYMENT,
            next_actions: [
              `Install dependencies: npm --prefix ${app.path} install`,
              `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
              VERIFY_STEP,
              CUSTOMIZE_STEP,
              `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
              brandingStep(app),
              `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
            ],
            next_commands: [
              `npm --prefix ${app.path} install`,
              `npm --prefix ${app.path} run dev`,
              expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
              expectedPublicCliCommand(app.asSetupSuggests("status")),
              expectedPublicCliCommand(
                app.asSetupSuggests("auth-method sso enable --provider google"),
              ),
            ],
          },
          warnings: [],
        });
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

      it.each([SCHEMA_FILE, FLOW_FILE])("writes %s", async (file) => {
        const app = await anApp();
        const before = await app.snapshot();

        await app.setup();

        expect((await before.changes()).added).toContain(file);
      });

      describe("with git", () => {
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

        describe("over a .gitignore that excepts .env.example before it ignores env files", () => {
          it("commits .env.example", async () => {
            const app = await anApp();
            await app.replaceGitignore(SVELTEKIT_GITIGNORE);

            await app.setup();

            expect(await app.trackedFiles()).toContain(".env.example");
          });

          it.each([".zitadel/secret", ".env.local", ".env.development.local"])(
            "keeps git from committing %s later",
            async (name) => {
              const app = await anApp();
              await app.replaceGitignore(SVELTEKIT_GITIGNORE);

              await app.setup();

              expect(await app.committableFiles()).not.toContain(name);
            },
          );
        });

        it("commits the configuration it wrote, which the release is built from", async () => {
          const app = await anApp();

          await app.setup();

          expect(await app.trackedFiles()).toContain(SCHEMA_FILE);
        });

        it("reports the repository it created when it could not commit, warning once", async () => {
          const app = await anApp();

          const result = await app.setupWithGitThatCannotCommit();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: { initialized: true, commit: null },
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [
              "Could not commit the scaffolded project (fatal: cannot commit); the first release records no commit, so the next deploy cannot show a diff. Setup created a new, empty git repository here.",
            ],
          });
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

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: { initialized: false, commit: expect.stringMatching(SHA) },
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("refuses a detached HEAD, where its commit would be on no branch", async () => {
          const app = await anApp();
          await app.underVersionControl();
          await app.onADetachedHead();

          const result = await app.setup();

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: "",
            code: "E_CONFLICT",
            message:
              "Setup cannot commit here: HEAD is detached, so the commit would be on no branch",
            hint: "Setup commits the project so the first release records a commit. Finish or abort what is under way, or check out a branch, then run setup again, or pass --no-git to set up without touching version control.",
          });
        });
      });

      describe("in a repository with uncommitted work", () => {
        it("refuses, naming the untracked file", async () => {
          const app = await anApp();
          await app.underVersionControl();
          await app.withUncommittedWork();

          const result = await app.setup();

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: "",
            code: "E_CONFLICT",
            message: "The git working tree has 1 untracked file",
            hint: "Setup commits the project directory so the first release records a commit, and it will not do that while there is work it did not write, which would be committed under setup's name. See them with git status, commit or stash them, then run setup again. If you have just scaffolded the app yourself, committing it first is the expected step. To set up without touching version control at all, pass --no-git.",
            details: { modified: [], untracked: ["notes.md"] },
          });
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

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: { initialized: false, commit: null },
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });
      });

      it("records no commit under --no-git", async () => {
        const app = await anApp();

        const result = await app.setup(["--no-git"]);

        expect(app.envelopeOf(result)).toEqual({
          cli_version: cliVersion.version,
          command: "setup",
          source: MOCK_SERVER_URL,
          status: "ok",
          data: {
            title: SET_UP_TITLE,
            project: PROJECT,
            framework: "next",
            server: MOCK_SERVER_URL,
            files_written: FILES_WRITTEN,
            files: FILES,
            files_skipped: [],
            install: INSTALL_SKIPPED,
            git: { initialized: false, commit: null },
            sign_in: SIGN_IN,
            sso: [],
            deployment: DEPLOYMENT,
            next_actions: [
              `Install dependencies: npm --prefix ${app.path} install`,
              `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
              VERIFY_STEP,
              CUSTOMIZE_STEP,
              `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
              brandingStep(app),
              `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
            ],
            next_commands: [
              `npm --prefix ${app.path} install`,
              `npm --prefix ${app.path} run dev`,
              expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
              expectedPublicCliCommand(app.asSetupSuggests("status")),
              expectedPublicCliCommand(
                app.asSetupSuggests("auth-method sso enable --provider google"),
              ),
            ],
          },
          warnings: [],
        });
      });

      describe("when it publishes the password policy", () => {
        it("publishes the recommended minimum length", async () => {
          const app = await anApp();

          await app.setup();

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY, config: { min_length: 15 } }),
            expect.objectContaining(DEFAULT_SIGNUP_POLICY),
          ]);
        });

        it("puts a given minimum length into the policy", async () => {
          const app = await anApp();

          await app.setup(["--password-min-length", "12"]);

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY, config: { min_length: 12 } }),
            expect.objectContaining(DEFAULT_SIGNUP_POLICY),
          ]);
        });

        it("reports a given minimum length as the one signing in will ask for", async () => {
          const app = await anApp();

          const result = await app.setup(["--password-min-length", "12"]);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: { ...SIGN_IN, password_min_length: 12 },
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("reads a minimum length of 0 as none", async () => {
          const app = await anApp();

          await app.setup(["--password-min-length", "0"]);

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY, config: {} }),
            expect.objectContaining(DEFAULT_SIGNUP_POLICY),
          ]);
        });

        it("refuses a minimum length outside the bounds before creating anything", async () => {
          const app = await anApp();

          const result = await app.setup(["--password-min-length", "65"]);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: "",
            code: "E_VALIDATION",
            message: "Must be a whole number from 1 to 64, or 0 for none",
            hint: "Pass a whole number for --password-min-length, or 0 for none.",
            details: { argument: "--password-min-length" },
          });
        });
      });

      describe("in a directory without an app", () => {
        it("creates a new app in the directory start ran in", async () => {
          const app = await aNewAppDirectory();
          await app.startLocalServer();

          const result = await app.setupNewApp();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: NEW_APP_FILES_WRITTEN,
              files: NEW_APP_FILES.slice(1),
              files_skipped: [".zitadel"],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("creates a new app in a directory whose name is not a valid package name", async () => {
          const app = await aNewAppDirectory("Tmp.W4SK1wDYDb");

          const result = await app.setupNewApp();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: NEW_APP_FILES_WRITTEN,
              files: NEW_APP_FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("creates a new app in a directory that does not exist yet", async () => {
          const app = await aMissingAppDirectory();

          const result = await app.setupNewApp();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: NEW_APP_FILES_WRITTEN,
              files: NEW_APP_FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });

        it("previews a new app on a dry run, with the real command to run next", async () => {
          const app = await aNewAppDirectory();

          const result = await app.setupNewApp(["--dry-run"]);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: WOULD_SET_UP_TITLE,
              dry_run: true,
              project: { project_id: "dry-run-0000", issuer: "http://localhost:3000" },
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: [],
              files: [],
              files_skipped: [],
              install: { status: "would-run", package_manager: "npm", command: "npm install" },
              git: { initialized: false, commit: null },
              sign_in: SIGN_IN,
              sso: [],
              deployment: null,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
                expectedPublicCliCommand(
                  `setup --skip-install --framework next --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
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

          expect(app.envelopeOf(rerun)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: NEW_APP_FILES_WRITTEN,
              files: NEW_APP_FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });
      });

      describe("on a dry run", () => {
        it("previews what it would write, with the real command to run next", async () => {
          const app = await anApp();

          const result = await app.setup(["--dry-run"]);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: WOULD_SET_UP_TITLE,
              dry_run: true,
              project: { project_id: "dry-run-0000", issuer: "http://localhost:3000" },
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WOULD_WRITE,
              files: FILES,
              files_skipped: [],
              install: { status: "would-run", package_manager: "npm", command: "npm install" },
              git: { initialized: false, commit: null },
              sign_in: SIGN_IN,
              sso: [],
              deployment: null,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
                expectedPublicCliCommand(
                  `setup --skip-install --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("writes nothing and creates nothing", async () => {
          const app = await anApp();
          const before = await app.snapshot();

          await app.setup(["--dry-run"]);

          expect(await before.changes()).toMatchObject(NO_CHANGES);
        });

        it("reports an app that is already set up as one it would leave alone", async () => {
          const app = await aCommittedApp();

          const result = await app.setup(["--dry-run"]);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: { title: "Zitadel is already set up in this app (dry run)", dry_run: true },
            warnings: [],
          });
        });

        it("reports moving the app to another port, with the real command to run next", async () => {
          const app = await aCommittedApp();

          const result = await app.setup(["--dev-port", "3001", "--force", "--dry-run"]);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Would move the app to http://localhost:3001 (dry run)",
              dry_run: true,
              moved: true,
              previous_issuer: "http://localhost:3000",
              issuer: "http://localhost:3001",
              dev_port: 3001,
              files_written: [".env.local", "zitadel.json", "AGENTS.md", "README.md"],
              deployment_id: null,
              next_actions: [],
              next_commands: [
                expectedPublicCliCommand(
                  `setup --skip-install --dev-port 3001 --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("leaves the origin where it was when it would move the app", async () => {
          const app = await aCommittedApp();

          await app.setup(["--dev-port", "3001", "--force", "--dry-run"]);

          expect(await app.projectOrigins()).toEqual([SETUP_ORIGIN]);
        });
      });

      describe("with the install", () => {
        it("reports the install it ran", async () => {
          const app = await anApp();

          const result = await app.setup([], { install: true });

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN,
              files: FILES,
              files_skipped: [],
              install: { status: "completed", package_manager: "npm", command: "npm install" },
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [],
          });
        });

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
        it("refuses, saying the version is below the supported floor", async () => {
          const app = await anApp({ nextVersion: "^14.2.0" });

          const result = await app.setup();

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            code: "E_UNSUPPORTED_PROJECT_SHAPE",
            message:
              'Next.js "^14.2.0" is below the supported floor — the CLI integrates Next.js 15.2.3 and newer',
            hint: "Upgrade the app to Next.js 15.2.3 or later and rerun. Earlier releases let a request skip middleware (CVE-2025-29927).",
          });
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

          expect(app.envelopeOf(rerun)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "skipped",
            reason: "already-initialized",
            data: { title: "Zitadel is already set up in this app" },
          });
        });

        it("skips after the developer edited the schema", async () => {
          const app = await aCommittedApp();
          await app.editUserSchema((schema) => {
            schema.properties.company = { type: "string" };
          });

          const rerun = await app.setup();

          expect(app.envelopeOf(rerun)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "skipped",
            reason: "already-initialized",
            data: { title: "Zitadel is already set up in this app" },
          });
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

        it("reports the move it made under --force", async () => {
          const app = await aCommittedApp();

          const result = await app.setup(["--dev-port", "3001", "--force"]);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: "Moved the app to http://localhost:3001",
              moved: true,
              previous_issuer: "http://localhost:3000",
              issuer: "http://localhost:3001",
              dev_port: 3001,
              files_written: [".env.local", "zitadel.json", "AGENTS.md", "README.md"],
              deployment_id: expect.stringMatching(/^dep_/),
              next_actions: ["Restart the dev server and open http://localhost:3001/login."],
            },
            warnings: [],
          });
        });

        describe("with --dev-port, without --force, when no one can be asked", () => {
          it("still succeeds, leaving the previous origin to remove with --force", async () => {
            const app = await aCommittedApp();

            const result = await app.setup(["--dev-port", "3001"]);

            expect(app.envelopeOf(result)).toEqual({
              cli_version: cliVersion.version,
              command: "setup",
              source: MOCK_SERVER_URL,
              status: "ok",
              data: {
                title: "Moved the app to http://localhost:3001",
                moved: true,
                previous_issuer: "http://localhost:3000",
                issuer: "http://localhost:3001",
                dev_port: 3001,
                files_written: [".env.local", "zitadel.json", "AGENTS.md", "README.md"],
                deployment_id: expect.stringMatching(/^dep_/),
                next_actions: ["Restart the dev server and open http://localhost:3001/login."],
                next_commands: [
                  expectedPublicCliCommand(
                    app.asSetupSuggests("origin rm http://localhost:3000 --force"),
                  ),
                ],
              },
              warnings: [
                `http://localhost:3000 is still among the project's origins; it admits a port nothing serves any more. Remove it with ${expectedPublicCliCommand(app.asSetupSuggests("origin rm http://localhost:3000 --force"))}.`,
              ],
            });
          });

          it("removes nothing", async () => {
            const app = await aCommittedApp();

            await app.setup(["--dev-port", "3001"]);

            expect(await app.projectOrigins()).toContainEqual(SETUP_ORIGIN);
          });
        });
      });

      describe("when its first deploy is refused", () => {
        it("succeeds, naming the deploy to run instead", async () => {
          const app = await anApp();
          platform.rejectsASchema();

          const result = await app.setup();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: null,
              next_actions: [
                `Deploy .zitadel/ so the project serves its release: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))}`,
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'")),
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [
              `The project was set up but its first deploy failed: release: invalid. Run ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish .zitadel/.`,
            ],
          });
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

      describe("against a server that does not take a sign-up policy yet", () => {
        it("writes none, and deploys the rest, warning once", async () => {
          const app = await anApp();
          platform.predatesTheSignupPolicy();

          const result = await app.setup();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN_WITHOUT_SIGNUP_POLICY,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            warnings: [
              `The server does not take a sign-up policy yet, so setup wrote none. Upgrade the server, then add .zitadel/policies/user.create.json and run ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))}.`,
            ],
          });
        });

        it("publishes the password policy alone", async () => {
          const app = await anApp();
          platform.predatesTheSignupPolicy();

          await app.setup();

          expect(await app.publishedPolicies()).toEqual([
            expect.objectContaining({ operation: PASSWORD_POLICY }),
          ]);
        });

        it("writes no sign-up policy file", async () => {
          const app = await anApp();
          platform.predatesTheSignupPolicy();

          await app.setup();

          expect((await app.snapshot()).paths()).not.toContain(
            app.policyFile(DEFAULT_SIGNUP_POLICY.operation),
          );
        });

        it("leaves a sign-up policy --force keeps, which no deploy gets past", async () => {
          const app = await anApp();
          await app.writeSignupPolicy({});
          platform.predatesTheSignupPolicy();

          const result = await app.setup(["--force"]);

          expect(result).toSucceed();
          expect((await app.snapshot()).paths()).toContain(
            app.policyFile(DEFAULT_SIGNUP_POLICY.operation),
          );
          expect(await app.liveDeploymentCount()).toBe(0);
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
        it("reports the connection it registered", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: PROJECT,
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: [
                ...FILES_WRITTEN.slice(0, 29),
                `.zitadel/idps/${provider.slug}.json`,
                ...FILES_WRITTEN.slice(29),
              ],
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: {
                ...SIGN_IN,
                methods: ["password", "passkey", "sso"],
                providers: [provider.slug],
              },
              sso: [
                {
                  provider: provider.selection,
                  slug: provider.slug,
                  client_id: provider.credentials.clientId,
                  connection: `.zitadel/idps/${provider.slug}.json`,
                  claim_mapping: { email: "email" },
                  new_attributes: [],
                  verified_claims: { email: "email_verified" },
                  scopes: ["openid", "profile", "email"],
                  unmapped: [],
                  used_by: ["default-human-user"],
                  callback_uri: `http://localhost:3000/__nextgen/idp/${provider.slug}/callback`,
                  client_id_variable: {
                    variable: `${provider.variables}_CLIENT_ID`,
                    published: "stored",
                  },
                  secret: { variable: `${provider.variables}_CLIENT_SECRET`, published: "stored" },
                },
              ],
              deployment: DEPLOYMENT,
              next_actions: [
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
              ],
              next_commands: [
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
              ],
            },
            warnings: [],
          });
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

        it("keeps the secret out of everything it prints", async () => {
          const app = await anApp();

          const result = await provider.setUp(app);

          expect(result).not.toSay(provider.credentials.secret);
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

      describe("with a custom provider and claim mappings", () => {
        const BUSINESS = ["--use-case", "business"];

        it("registers the connection with the claim it was given", async () => {
          const app = await anApp();
          await app.setupWithCustomSso(ACME, ACME_CREDENTIALS, [
            ...BUSINESS,
            "--sso-claim",
            "companyName=organization",
          ]);

          const [registered] = await app.registeredIdps();

          expect(registered?.definition?.claim_mapping).toMatchObject({
            companyName: "organization",
            givenName: "given_name",
          });
        });

        it("leaves nothing to reconcile after the provider is set up with a claim", async () => {
          const app = await anApp();
          await app.setupWithCustomSso(ACME, ACME_CREDENTIALS, [
            ...BUSINESS,
            "--sso-claim",
            "companyName=organization",
          ]);

          const data = await app.deployDryRunData();

          expect(data.diff?.files).toEqual([]);
        });

        it.each([
          ["a property the schema does not define", "shoeSize=shoe"],
          ["a claim that already fills a property", "companyName=given_name"],
        ])("refuses %s", async (_what, claim) => {
          const app = await anApp();

          const result = await app.setupWithCustomSso(ACME, ACME_CREDENTIALS, [
            ...BUSINESS,
            "--sso-claim",
            claim,
          ]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("writes nothing when the claim is refused", async () => {
          const app = await anApp();
          const before = await app.snapshot();

          await app.setupWithCustomSso(ACME, ACME_CREDENTIALS, [
            ...BUSINESS,
            "--sso-claim",
            "shoeSize=shoe",
          ]);

          expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        });

        it("refuses a claim given without a provider", async () => {
          const app = await anApp();

          const result = await app.setup(["--sso-claim", "companyName=organization"]);

          expect(result).toFailWith("E_VALIDATION");
        });
      });

      describe("with a custom provider but not both credentials", () => {
        it("will not set up the provider without a client secret, naming how to pipe it in", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(ACME_FLAGS_WITH_CLIENT_ID, "");

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            code: "E_VALIDATION",
            message: "No client secret supplied",
            hint: `Pipe it in on stdin. It is never a flag: that would put it in shell history, a process listing and CI logs. For example: printf '%s' "$CLIENT_SECRET" | ${expectedPublicCliCommand(`setup --sso custom --sso-client-id '<id>' --cwd ${app.path} ...`)}`,
            next_commands: [
              `printf '%s' "$CLIENT_SECRET" | ${expectedPublicCliCommand(`setup --sso custom --sso-client-id '<id>' --cwd ${app.path} ...`)}`,
            ],
          });
        });

        it("will not set up the provider without a client id", async () => {
          const app = await anApp();

          const result = await app.setupSsoWith(ACME_FLAGS, ACME_CREDENTIALS.secret);

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: "",
            code: "E_VALIDATION",
            message: "--sso custom needs --sso-client-id",
            hint: "Register a client at https://sso.acme.example and pass its client id.",
          });
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

      describe("when the server mints a project id holding an escape sequence", () => {
        it("carries the id as it was minted, escape sequence and all", async () => {
          const app = await anApp();
          platform.mintsAHostileProjectId();

          const result = await app.setup();

          expect(app.envelopeOf(result)).toEqual({
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            status: "ok",
            data: {
              title: SET_UP_TITLE,
              project: { project_id: "proj-\u001b[2Jwiped", issuer: "http://localhost:3000" },
              framework: "next",
              server: MOCK_SERVER_URL,
              files_written: FILES_WRITTEN_WITHOUT_SIGNUP_POLICY,
              files: FILES,
              files_skipped: [],
              install: INSTALL_SKIPPED,
              git: COMMITTED,
              sign_in: SIGN_IN,
              sso: [],
              deployment: null,
              next_actions: [
                `Deploy .zitadel/ so the project serves its release: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))}`,
                `Install dependencies: npm --prefix ${app.path} install`,
                `Start your project: npm --prefix ${app.path} run dev (then open http://localhost:3000/register)`,
                VERIFY_STEP,
                CUSTOMIZE_STEP,
                `See your changes before they go live: ${expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run"))} to preview, then ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish. The project serves only what is deployed, so an edit takes effect once you deploy it.`,
                brandingStep(app),
                `Add social sign-in whenever you are ready: ${expectedPublicCliCommand(app.asSetupSuggests("auth-method sso enable --provider google"))}`,
              ],
              next_commands: [
                expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'")),
                `npm --prefix ${app.path} install`,
                `npm --prefix ${app.path} run dev`,
                expectedPublicCliCommand(app.asSetupSuggests("deploy --dry-run")),
                expectedPublicCliCommand(app.asSetupSuggests("status")),
                expectedPublicCliCommand(
                  app.asSetupSuggests("auth-method sso enable --provider google"),
                ),
              ],
            },
            // This pins a misleading warning. The server refuses the minted id
            // in the probe's query as req.invalid, and the probe
            // (serverTakesSignupPolicy in src/cli/commands/setup/index.ts) reads any
            // req.invalid as a server without the sign-up policy, so setup
            // drops user.create.json for a server that takes it.
            warnings: [
              `The server does not take a sign-up policy yet, so setup wrote none. Upgrade the server, then add .zitadel/policies/user.create.json and run ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))}.`,
              `The project was set up but its first deploy failed: request does not conform to spec. Run ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish .zitadel/.`,
            ],
          });
        });
      });

      describe("when the server does not answer", () => {
        it("stops on Ctrl-C, in one envelope", async () => {
          const app = await anApp();
          const waiting = platform.hangs();

          const result = app.setup();
          await waiting;
          pressCtrlC();

          expect(app.envelopeOf(await result)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "setup",
            source: MOCK_SERVER_URL,
            code: "E_CANCELLED",
            message: "Cancelled",
            hint: "The command was cancelled with Ctrl-C.",
          });
        });

        it("exits 130 on Ctrl-C", async () => {
          const app = await anApp();
          const waiting = platform.hangs();

          const result = app.setup();
          await waiting;
          pressCtrlC();

          expect(await result).toExitWith(130);
        });

        it("does not claim to be configured after Ctrl-C", async () => {
          const app = await anApp();
          const waiting = platform.hangs();

          const result = app.setup();
          await waiting;
          pressCtrlC();
          await result;

          expect(await app.hasBeenConfigured()).toBe(false);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("closes its narration on the headline the envelope carries", async () => {
        const app = await anApp();

        const result = await app.setupRendered();

        expect(result).toSayOnce(SET_UP_TITLE);
      });

      it("closes a dry run's narration on the headline the envelope carries", async () => {
        const app = await anApp();

        const result = await app.setupRendered(["--dry-run"]);

        expect(result).toSayOnce(WOULD_SET_UP_TITLE);
      });

      it("names the app's address when piped", async () => {
        const app = await anApp();

        const result = await app.setupRendered();

        expect(result).toPrint("App will run   http://localhost:3000");
      });

      it("names the server it ran against when piped", async () => {
        const app = await anApp();

        const result = await app.setupRendered();

        expect(result).toPrint(`Server         ${MOCK_SERVER_URL}`);
      });

      it("names the real command after a dry run", async () => {
        const app = await anApp();

        const result = await app.setupRendered(["--dry-run"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(
            `setup --skip-install --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          ),
        );
      });

      it("says to deploy once, when the first deploy was refused", async () => {
        const app = await anApp();
        platform.rejectsASchema();

        const result = await app.setupRendered();

        expect(result).toSayOnce(
          `The project was set up but its first deploy failed: release: invalid. Run ${expectedPublicCliCommand(app.asSetupSuggests("deploy --message '<what changed>'"))} to publish .zitadel/.`,
        );
      });

      it("says the next steps' commands once", async () => {
        const app = await anApp();

        const result = await app.setupRendered();

        expect(result).toSayOnce(expectedPublicCliCommand(app.asSetupSuggests("status")));
      });

      it("spells out an escape sequence in the project id", async () => {
        const app = await anApp();
        platform.mintsAHostileProjectId();

        const result = await app.setupRendered();

        expect(result).toPrint("Project id     proj-\\x1b[2Jwiped");
      });

      it("keeps the client secret out of everything it prints", async () => {
        const app = await anApp();

        const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

        expect(result).not.toSay(ACME_CREDENTIALS.secret);
      });

      it("names the provider in the connection's box", async () => {
        const app = await anApp();

        const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

        expect(result).toPrint("When someone signs in with Acme SSO");
      });

      it("says which claim fills each attribute", async () => {
        const app = await anApp();

        const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

        expect(result).toPrint("- email comes from the provider's email claim.");
      });

      it("says which schemas sign in through the connection", async () => {
        const app = await anApp();

        const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

        expect(result).toPrint("This connection is used by default-human-user");
      });

      it("says which scopes it asks the provider for", async () => {
        const app = await anApp();

        const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

        expect(result).toPrint(
          "Zitadel asks Acme SSO for these scopes: openid, profile, and email.",
        );
      });

      it("says where to change the mapping", async () => {
        const app = await anApp();

        const result = await app.setupWithCustomSsoRendered(ACME, ACME_CREDENTIALS);

        expect(result).toPrint("To change which claim fills an attribute, edit claim_mapping in");
      });
    });
  });
});
