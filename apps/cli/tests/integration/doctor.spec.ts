import { describe, expect, it } from "vitest";

import { Cmd } from "@/lib/cmd";
import { asAnOlderSetupLeft, SVELTEKIT_GITIGNORE } from "@tests/helpers/gitignore";
import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import {
  aSetUpApp,
  aSetUpReactApp,
  MOCK_SERVER_URL,
  SETUP_ORIGIN,
  type ScaffoldedApp,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();
useLocalServers();

const CLI_VERSION = cliVersion.version;

const RESET_AND_START_HINT =
  "Reset the local runtime, then start it again, each with the --cwd of the directory that holds it.";

/** Any absolute path, for the checks that name a directory of the app they ran in. */
const A_PATH = "(?:/[^/]+)+";

/** Every check a project straight out of setup passes, in the order `doctor` runs them. */
const CHECK = {
  cliVersion: {
    name: "cli-version",
    status: "pass",
    message: `CLI ${CLI_VERSION}; update check is off`,
    category: "versions",
  },
  serverBinary: {
    name: "server-binary",
    status: "pass",
    message: `@zitadel/server ${CLI_VERSION} is available`,
    category: "local_server",
  },
  stateDir: {
    name: "state-dir",
    status: "pass",
    message: expect.stringMatching(
      new RegExp(
        `^${A_PATH}/\\.zitadel/local/nextgen-data can be created \\(${A_PATH}/\\.zitadel is writable\\)$`,
      ),
    ),
    category: "local_server",
  },
  port: {
    name: "port",
    status: "pass",
    message: expect.stringMatching(/^Port \d+ is available$/),
    category: "local_server",
  },
  runtime: {
    name: "runtime",
    status: "pass",
    message: "No existing runtime metadata",
    category: "local_server",
  },
  processes: {
    name: "managed-runtime-processes",
    status: "pass",
    message: "No other local Zitadel server is running on this machine.",
    details: { supported: true, scope: "host", processes: [] },
    category: "local_server",
  },
  config: {
    name: "config",
    status: "pass",
    message: "zitadel.json parses",
    path: "zitadel.json",
    category: "project",
  },
  secret: {
    name: "secret",
    status: "pass",
    message: ".zitadel/secret parses",
    path: ".zitadel/secret",
    category: "credentials",
  },
  secretPermissions: {
    name: "secret-permissions",
    status: "pass",
    message: ".zitadel/secret has 0600 permissions",
    path: ".zitadel/secret",
    category: "credentials",
  },
  gitignore: {
    name: "gitignore",
    status: "pass",
    message: ".gitignore protects local secret/env files",
    path: ".gitignore",
    category: "credentials",
  },
  envExample: {
    name: "env-example",
    status: "pass",
    message: ".env.example references required keys",
    path: ".env.example",
    category: "credentials",
  },
  framework: {
    name: "framework",
    status: "pass",
    message: "Detected framework matches recorded framework",
    path: "zitadel.json",
    category: "app_integration",
  },
  schema: {
    name: "schema",
    status: "pass",
    message: "The configuration in .zitadel/ is valid",
    path: ".zitadel/schemas",
    category: "project",
  },
  dependency: {
    name: "dependency",
    status: "pass",
    message: "package.json depends on the Zitadel SDK packages the app imports",
    path: "package.json",
    category: "app_integration",
  },
  dependencyVersion: {
    name: "dependency-version",
    path: "package.json",
    status: "pass",
    message: "Zitadel package pins match the CLI version (1 compared)",
    category: "versions",
  },
  managedFiles: {
    name: "managed-files",
    status: "pass",
    message: "Scaffolded app files are present (5 tracked, 1 wiring verified)",
    details: {
      mode: "manifest",
      files: [
        { path: "app/login/page.tsx", class: "presentation", state: "pristine" },
        { path: "app/register/page.tsx", class: "presentation", state: "pristine" },
        { path: "app/profile/page.tsx", class: "presentation", state: "pristine" },
        { path: "proxy.ts", class: "infrastructure", state: "pristine" },
        { path: "custom-elements.d.ts", class: "infrastructure", state: "pristine" },
      ],
      config_wiring: [{ path: "package.json", wiring: "convenience", state: "applied" }],
    },
    category: "app_integration",
  },
  managedFilesUnwired: {
    name: "managed-files",
    status: "pass",
    message: "Scaffolded app files are present (5 tracked)",
    details: {
      mode: "manifest",
      files: [
        { path: "app/login/page.tsx", class: "presentation", state: "pristine" },
        { path: "app/register/page.tsx", class: "presentation", state: "pristine" },
        { path: "app/profile/page.tsx", class: "presentation", state: "pristine" },
        { path: "proxy.ts", class: "infrastructure", state: "pristine" },
        { path: "custom-elements.d.ts", class: "infrastructure", state: "pristine" },
      ],
    },
    category: "app_integration",
  },
  metaSchemas: {
    name: "meta-schemas",
    path: ".zitadel/meta",
    status: "pass",
    message: "Editor schemas in .zitadel/meta/ match this CLI",
    category: "versions",
  },
  projectMatch: {
    name: "project-match",
    status: "pass",
    message: ".zitadel/secret project_id matches zitadel.json project",
    path: ".zitadel/secret",
    category: "credentials",
  },
  issuerOrigin: {
    name: "issuer-origin",
    status: "pass",
    message: "http://localhost:3000 is not recorded as a preview origin",
    path: ".zitadel/secret",
    category: "project",
  },
  claim: {
    name: "claim",
    status: "pass",
    message: "Project is not on a server where teams apply",
    path: ".zitadel/secret",
    category: "project",
  },
};

/** A passing doctor run whose managed-files check passed. */
const MANAGED_FILES_PASSING = {
  data: {
    checks: expect.arrayContaining([
      expect.objectContaining({ name: "managed-files", status: "pass" }),
    ]),
  },
};

/** What the checks of a project that needs nothing say: all of them, passing. */
const HEALTHY = [
  CHECK.cliVersion,
  CHECK.serverBinary,
  CHECK.stateDir,
  CHECK.port,
  CHECK.runtime,
  CHECK.processes,
  CHECK.config,
  CHECK.secret,
  CHECK.secretPermissions,
  CHECK.gitignore,
  CHECK.envExample,
  CHECK.framework,
  CHECK.schema,
  CHECK.dependency,
  CHECK.dependencyVersion,
  CHECK.managedFiles,
  CHECK.metaSchemas,
  CHECK.projectMatch,
  CHECK.issuerOrigin,
  CHECK.claim,
];

/** Downgrades the app below the version the CLI supports. */
function downgradeTheFramework(app: ScaffoldedApp): Promise<void> {
  return app.editPackageJson((pkg) => {
    pkg.dependencies.next = "^14.2.0";
  });
}

/** Leaves a range the floor accepts, with a release below the floor installed under it. */
async function installAnOldFrameworkUnderARange(app: ScaffoldedApp): Promise<void> {
  await app.editPackageJson((pkg) => {
    pkg.dependencies.next = "^15.0.0";
  });
  await app.hasInstalled("next", "15.2.2");
}

describe("doctor", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.doctor();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
          },
          warnings: [],
        });
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.doctor();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
          },
          warnings: [],
        });
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.doctor();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
          },
          warnings: [],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();

      await app.inEveryRendering((how) =>
        how.json ? app.doctor([], how.env) : app.doctorRendered([], how.env),
      );
    });

    describe("--json", () => {
      it("passes a project straight out of setup, every check under a category", async () => {
        const app = await aSetUpApp();

        const result = await app.doctor();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
          },
          warnings: [],
        });
      });

      it("warns and suggests upgrading when a newer CLI exists", async () => {
        const app = await aSetUpApp();
        platform.publishesCli("99.0.0");

        const result = await app.doctorLookingForUpdates();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "Checks passed with warnings",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: [
              {
                name: "cli-version",
                status: "warn",
                message: `CLI ${CLI_VERSION} is behind the latest version, 99.0.0`,
                details: {
                  current: CLI_VERSION,
                  latest: "99.0.0",
                  remedy_command: `npx @zitadel/cli@latest upgrade --cwd ${app.path}`,
                },
                category: "versions",
              },
              ...HEALTHY.slice(1),
            ],
            next_actions: [
              "Upgrade to the latest release; this moves the exactly-pinned @zitadel/* dependencies with it and refreshes generated files.",
            ],
            next_commands: [`npx @zitadel/cli@latest upgrade --cwd ${app.path}`],
          },
          warnings: [`cli-version: CLI ${CLI_VERSION} is behind the latest version, 99.0.0`],
        });
      });

      it("still succeeds when the registry is out of reach", async () => {
        const app = await aSetUpApp();
        platform.npmRegistryIsDown();

        const result = await app.doctorLookingForUpdates();

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: [
              {
                name: "cli-version",
                status: "pass",
                message: `CLI ${CLI_VERSION}; could not look up the latest version`,
                category: "versions",
              },
              ...HEALTHY.slice(1),
            ],
          },
          warnings: [],
        });
      });

      it("verifies the resolved environment connects under --env", async () => {
        const app = await aSetUpApp();

        const result = await app.doctor(["--env", "development"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: [
              ...HEALTHY,
              {
                name: "environment",
                status: "pass",
                message: expect.stringMatching(
                  /^http:\/\/mock\.zitadel\.test is reachable and project proj-[0-9a-f]{12} matches$/,
                ),
                category: "environment",
              },
            ],
          },
          warnings: [],
        });
      });

      it("fails when the resolved environment names a project the server does not have", async () => {
        const app = await aSetUpApp();
        await app.bindEnvironment("production", {
          ZITADEL_URL: "https://prod.example",
          ZITADEL_PROJECT_ID: "proj_missing",
          ZITADEL_PROJECT_SECRET: "sk_prod",
        });

        const result = await app.doctor(["--env", "production"]);

        const selector = `--env production --server ${MOCK_SERVER_URL} --cwd ${app.path}`;
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          code: "E_VALIDATION",
          message: "Zitadel doctor found issues",
          hint: `The resolved environment could not connect. Check the server, project and credential it resolves with ${expectedPublicCliCommand(`env ${selector}`)}, then rerun ${expectedPublicCliCommand(`doctor --port ${app.doctoredPortOf(result)} ${selector}`)}.`,
          next_commands: [
            expectedPublicCliCommand(`env ${selector}`),
            expectedPublicCliCommand(`doctor --port ${app.doctoredPortOf(result)} ${selector}`),
          ],
          details: {
            title: "Zitadel doctor found issues",
            ok: false,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "configured" },
            checks: [
              ...HEALTHY,
              {
                name: "environment",
                status: "fail",
                message: "resource not found",
                category: "environment",
              },
            ],
          },
        });
      });

      it("reports an unsupported framework version, pointing at the upgrade and offering no repair", async () => {
        const app = await aSetUpApp();
        await downgradeTheFramework(app);

        const result = await app.doctor();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          code: "E_UNSUPPORTED_PROJECT_SHAPE",
          message: "Zitadel doctor found issues",
          hint: "Upgrade the app to Next.js 15.2.3 or later and rerun. Earlier releases let a request skip middleware (CVE-2025-29927).",
          next_commands: [
            expectedPublicCliCommand(
              `doctor --port ${app.doctoredPortOf(result)} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
          details: {
            title: "Zitadel doctor found issues",
            ok: false,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "configured" },
            checks: [
              ...HEALTHY.slice(0, 11),
              {
                name: "framework",
                status: "fail",
                message:
                  'Next.js "^14.2.0" is below the supported floor — the CLI integrates Next.js 15.2.3 and newer',
                path: "zitadel.json",
                code: "E_UNSUPPORTED_PROJECT_SHAPE",
                hint: "Upgrade the app to Next.js 15.2.3 or later and rerun. Earlier releases let a request skip middleware (CVE-2025-29927).",
                category: "app_integration",
              },
              CHECK.schema,
              CHECK.dependency,
              CHECK.dependencyVersion,
              CHECK.managedFilesUnwired,
              ...HEALTHY.slice(16),
            ],
          },
        });
      });

      it("reports an installed framework version below the floor, pointing at the upgrade", async () => {
        const app = await aSetUpApp();
        await installAnOldFrameworkUnderARange(app);

        const result = await app.doctor();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          code: "E_UNSUPPORTED_PROJECT_SHAPE",
          message: "Zitadel doctor found issues",
          hint: "Upgrade the app to Next.js 15.2.3 or later and rerun. Earlier releases let a request skip middleware (CVE-2025-29927).",
          next_commands: [
            expectedPublicCliCommand(
              `doctor --port ${app.doctoredPortOf(result)} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
            ),
          ],
          details: {
            title: "Zitadel doctor found issues",
            ok: false,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "configured" },
            checks: [
              ...HEALTHY.slice(0, 11),
              {
                name: "framework",
                status: "fail",
                message: expect.any(String),
                path: "zitadel.json",
                code: "E_UNSUPPORTED_PROJECT_SHAPE",
                hint: "Upgrade the app to Next.js 15.2.3 or later and rerun. Earlier releases let a request skip middleware (CVE-2025-29927).",
                category: "app_integration",
              },
              CHECK.schema,
              CHECK.dependency,
              CHECK.dependencyVersion,
              CHECK.managedFilesUnwired,
              ...HEALTHY.slice(16),
            ],
          },
        });
      });

      it("restores a scaffolded page the developer deleted", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile("app/login/page.tsx");
        const before = await app.snapshot();

        const result = await app.doctor(["--fix"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
          },
          warnings: [],
        });
        expect((await before.changes()).added).toContain("app/login/page.tsx");
      });

      it("moves a Vite app's dev proxy that fixes the server's address onto ZITADEL_URL", async () => {
        const app = await aSetUpReactApp();
        await app.fixesItsServerAddress();

        const result = await app.doctor(["--fix"]);

        expect(app.envelopeOf(result)).toMatchObject(MANAGED_FILES_PASSING);
      });

      describe("in an app an older setup left with .env.example ignored", () => {
        it("passes with a warning", async () => {
          const app = await aSetUpApp();
          await app.leftByAnOlderSetup(asAnOlderSetupLeft(SVELTEKIT_GITIGNORE));

          const result = await app.doctor();

          expect(app.envelopeOf(result)).toMatchObject({
            status: "ok",
            data: { ok: true, title: "Checks passed with warnings" },
          });
        });

        it("lets git commit .env.example once --fix has run", async () => {
          const app = await aSetUpApp();
          await app.leftByAnOlderSetup(asAnOlderSetupLeft(SVELTEKIT_GITIGNORE));

          await app.doctor(["--fix"]);

          expect(await app.committableFiles()).toContain(".env.example");
        });

        it.each([".zitadel/secret", ".env.local", ".env.development.local"])(
          "keeps git from committing %s once --fix has run",
          async (name) => {
            const app = await aSetUpApp();
            await app.leftByAnOlderSetup(asAnOlderSetupLeft(SVELTEKIT_GITIGNORE));

            await app.doctor(["--fix"]);

            expect(await app.committableFiles()).not.toContain(name);
          },
        );
      });

      it("removes nothing while repairing", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile("app/login/page.tsx");
        const before = await app.snapshot();

        const result = await app.doctor(["--fix"]);

        expect(app.envelopeOf(result)).toMatchObject({ status: "ok" });
        expect((await before.changes()).removed).toEqual([]);
      });

      it("points a project that lacks an editor schema at --fix", async () => {
        const app = await aSetUpApp();
        await app.lacksEditorSchema("branding");

        const result = await app.doctor();

        const message =
          "Editor schemas in .zitadel/meta/: 1 missing. They are generated by the CLI; doctor --fix writes this version's.";
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "Checks passed with warnings",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: [
              ...HEALTHY.slice(0, 16),
              {
                name: "meta-schemas",
                path: ".zitadel/meta",
                status: "warn",
                message,
                details: { missing: [".zitadel/meta/branding.json"], outdated: [] },
                category: "versions",
              },
              ...HEALTHY.slice(17),
            ],
            next_actions: [
              "Write this CLI version's editor schemas into .zitadel/meta/; editors and agents read the dialect from there.",
            ],
            next_commands: [
              expectedPublicCliCommand(
                `doctor --fix --port ${app.doctoredPortOf(result)} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [`meta-schemas: ${message}`],
        });
      });

      it("makes the issuer setup 0.1.0 registered as a preview origin primary", async () => {
        const app = await aSetUpApp();
        await app.hasItsIssuerAsAPreviewOrigin();

        const result = await app.doctor(["--fix", "--force"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "All checks passed",
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
          },
          warnings: [],
        });
        expect(await app.projectOrigins()).toEqual([SETUP_ORIGIN]);
      });

      describe("without --force when no one can be asked", () => {
        it("warns, says to pass --force and suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          await app.hasItsIssuerAsAPreviewOrigin();

          const result = await app.doctor(["--fix"]);

          const message = `The project has no primary origin to deploy to: it holds http://localhost:3000 as a preview origin, as setup 0.1.0 registered it. Run ${expectedPublicCliCommand(`doctor --fix --server ${MOCK_SERVER_URL} --cwd ${app.path}`)} to make it primary.`;
          expect(app.envelopeOf(result)).toEqual({
            status: "ok",
            cli_version: CLI_VERSION,
            command: "doctor",
            source: `http://localhost:${app.doctoredPortOf(result)}`,
            data: {
              title: "Checks passed with warnings",
              ok: true,
              runtime: "binary",
              port: app.doctoredPortOf(result),
              project: { lifecycle: "configured" },
              checks: [
                ...HEALTHY.slice(0, 18),
                {
                  name: "issuer-origin",
                  status: "warn",
                  message,
                  details: { pattern: "http://localhost:3000", server: MOCK_SERVER_URL },
                  path: ".zitadel/secret",
                  category: "project",
                },
                CHECK.claim,
              ],
              next_actions: [
                "Make the app's issuer a primary origin; a deploy lands only on primary origins, and setup 0.1.0 registered it as a preview one.",
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `doctor --fix --force --port ${app.doctoredPortOf(result)} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [
              expect.stringMatching(
                /^Cannot replace the preview origin http:\/\/localhost:3000 with a primary one without --force in non-interactive mode\. Ask a person first: Replace the preview origin http:\/\/localhost:3000 with a primary one in project proj-[0-9a-f]{12} on mock\.zitadel\.test\? Pass --force only once they agree\.$/,
              ),
              `issuer-origin: ${message}`,
            ],
          });
        });

        it("replaces nothing", async () => {
          const app = await aSetUpApp();
          await app.hasItsIssuerAsAPreviewOrigin();

          const result = await app.doctor(["--fix"]);

          expect(app.envelopeOf(result)).toMatchObject({ status: "ok" });
          expect(await app.projectOrigins()).toEqual([{ ...SETUP_ORIGIN, kind: "preview" }]);
        });
      });

      it("answers a planned repair as a dry run and suggests the real one with the flags it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.doctor(["--fix", "--dry-run"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: `http://localhost:${app.doctoredPortOf(result)}`,
          data: {
            title: "All checks passed (dry run)",
            dry_run: true,
            ok: true,
            runtime: "binary",
            port: app.doctoredPortOf(result),
            project: { lifecycle: "configured" },
            checks: HEALTHY,
            next_commands: [
              expectedPublicCliCommand(
                `doctor --fix --port ${app.doctoredPortOf(result)} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("repairs nothing in a dry run", async () => {
        const app = await aSetUpApp();
        await app.deleteProjectFile("app/login/page.tsx");
        const before = await app.snapshot();

        const result = await app.doctor(["--fix", "--dry-run"]);

        expect(app.envelopeOf(result)).toMatchObject({ data: { dry_run: true } });
        expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("refuses --force without --fix", async () => {
        const app = await aSetUpApp();

        const result = await app.doctor(["--force"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: "",
          code: "E_VALIDATION",
          message: "All of the following must be provided when using --force: --fix",
          next_commands: [expectedPublicCliCommand("doctor --help")],
          details: {
            original: {
              name: "Error",
              message:
                "The following error occurred:\n  All of the following must be provided when using --force: --fix\nSee more help with --help",
            },
          },
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("groups a healthy project under its categories", async () => {
        const app = await aSetUpApp();

        const result = await app.doctorRendered();

        expect(result).toPrintRow("[✓]", "Versions", `CLI ${CLI_VERSION}`);
        expect(result).toPrintRow("[✓]", "Credentials", "5 checks passed");
      });

      it("says its verdict once, as the title --json carries", async () => {
        const app = await aSetUpApp();

        const result = await app.doctorRendered();

        expect(result).toSayOnce("All checks passed");
      });

      it("says in the title that a repair was only planned", async () => {
        const app = await aSetUpApp();

        const result = await app.doctorRendered(["--fix", "--dry-run"]);

        expect(result).toSayOnce("All checks passed (dry run)");
      });

      it("prints the repair it planned, with the port it was given, once", async () => {
        const app = await aSetUpApp();

        const result = await app.doctorRendered(["--fix", "--dry-run"]);

        expect(result).toSayOnce(expectedPublicCliCommand("doctor --fix --port"));
      });

      it("prints which port the local server is on", async () => {
        const app = await aSetUpApp();

        const result = await app.doctorRendered();

        expect(result).toPrint("running on port");
      });

      it("shows which check failed, not only that one did", async () => {
        const app = await aSetUpApp();
        await downgradeTheFramework(app);

        const result = await app.doctorRendered();

        expect(result).toPrint("[✗] App integration");
        expect(result).toPrint("below the supported floor");
      });

      it("says the failure once, on stderr, with the way out", async () => {
        const app = await aSetUpApp();
        await downgradeTheFramework(app);

        const result = await app.doctorRendered();

        expect(result.stderr).toContain(
          "Upgrade the app to Next.js 15.2.3 or later and rerun. Earlier releases let a request skip middleware (CVE-2025-29927).",
        );
        expect(result).toSayOnce("Zitadel doctor found issues (E_UNSUPPORTED_PROJECT_SHAPE)");
      });

      it("says each warning once", async () => {
        const app = await aSetUpApp();
        await app.hasItsIssuerAsAPreviewOrigin();

        const result = await app.doctorRendered(["--fix"]);

        expect(result).toSayOnce("Cannot replace the preview origin http://localhost:3000");
      });

      it("lists every check with --verbose", async () => {
        const app = await aSetUpApp();

        const result = await app.doctorRendered(["--verbose"]);

        expect(result).toPrint("config: zitadel.json parses");
      });
    });
  });

  describe("in an app inside the directory a local server was started in", () => {
    it("finds that server healthy, on its port", async () => {
      const parent = await aSetUpApp();
      const started = await parent.startLocalServer();
      const app = await parent.appInside("my-app");

      const result = await app.doctorAtItsServer();

      expect(app.envelopeOf(result)).toEqual({
        status: "ok",
        cli_version: CLI_VERSION,
        command: "doctor",
        source: `http://localhost:${parent.localPortOf(started)}`,
        data: {
          title: "All checks passed",
          ok: true,
          runtime: "binary",
          port: parent.localPortOf(started),
          project: { lifecycle: "not-configured" },
          checks: [
            CHECK.cliVersion,
            CHECK.serverBinary,
            {
              name: "state-dir",
              status: "pass",
              message: `${parent.path}/.zitadel/local/nextgen-data is writable`,
              category: "local_server",
            },
            {
              name: "port",
              status: "pass",
              message: `http://localhost:${parent.localPortOf(started)} is already healthy`,
              category: "local_server",
            },
            {
              name: "runtime",
              status: "pass",
              message: `http://localhost:${parent.localPortOf(started)} is healthy (server started in the parent folder ${parent.path})`,
              category: "local_server",
            },
            CHECK.processes,
          ],
          next_actions: [
            `When a sign-in or a request fails, the server's log says why: run ${expectedPublicCliCommand(`logs --follow --cwd ${app.path}`)} in another terminal to watch it.`,
          ],
        },
        warnings: [],
      });
    });

    describe("that is not running", () => {
      it("fails, and offers to start it again or reset it where it was started", async () => {
        const parent = await aSetUpApp();
        await parent.writeStoppedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
          code: "E_VALIDATION",
          message: "Zitadel doctor found issues",
          hint: `This folder has no Zitadel server of its own, so doctor checked the one in the parent folder, ${parent.path}, and found a problem with it. To keep using it, fix it or start it again. To give this folder its own server, run start here instead. Resetting deletes the local data in ${parent.path}, not in this folder.`,
          next_commands: [
            expectedPublicCliCommand(`start --cwd ${parent.path}`),
            expectedPublicCliCommand(`start --cwd ${app.path}`),
            expectedPublicCliCommand(`reset --force --cwd ${parent.path}`),
          ],
          details: {
            title: "Zitadel doctor found issues",
            ok: false,
            runtime: "binary",
            port: expect.any(Number),
            project: { lifecycle: "not-configured" },
            checks: [
              CHECK.cliVersion,
              CHECK.serverBinary,
              {
                name: "state-dir",
                status: "pass",
                message: `${parent.path}/.zitadel/local/nextgen-data can be created (${parent.path}/.zitadel/local is writable)`,
                category: "local_server",
              },
              CHECK.port,
              {
                name: "runtime",
                status: "fail",
                message: expect.stringMatching(
                  /^http:\/\/localhost:\d+ is not ready: \/readyz did not answer ok$/,
                ),
                category: "local_server",
              },
              CHECK.processes,
            ],
            suggested_args: [
              ["start", "--cwd", parent.path],
              ["start", "--cwd", app.path],
              ["reset", "--force", "--cwd", parent.path],
            ],
          },
        });
      });
    });

    describe("whose record is malformed", () => {
      it("fails, and offers to reset it and start it where it was started", async () => {
        const parent = await aSetUpApp();
        await parent.writeMalformedServerRecord();
        const app = await parent.appInside("my-app");

        const result = await app.doctorAtItsServer();

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "doctor",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: ".zitadel/local/runtime.json is malformed",
          hint: RESET_AND_START_HINT,
          next_commands: [
            expectedPublicCliCommand(`reset --force --cwd ${parent.path}`),
            expectedPublicCliCommand(`start --cwd ${parent.path}`),
          ],
          details: {
            x: 1,
            suggested_args: [
              ["reset", "--force", "--cwd", parent.path],
              ["start", "--cwd", parent.path],
            ],
          },
        });
      });
    });

    describe("in a directory whose path needs shell quoting", () => {
      async function parentNamed(name: string): Promise<ScaffoldedApp> {
        const outer = await aSetUpApp();
        return outer.appInside(name);
      }

      it.each(["my app", "it's"])(
        "quotes the directory in the commands that start it again and reset it, and hands it over as it is in the arguments (%s)",
        async (name) => {
          const parent = await parentNamed(name);
          await parent.writeStoppedServerRecord();
          const app = await parent.appInside("my-app");

          const result = await app.doctorAtItsServer();

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: CLI_VERSION,
            command: "doctor",
            source: expect.stringMatching(/^http:\/\/localhost:\d+$/),
            code: "E_VALIDATION",
            message: "Zitadel doctor found issues",
            hint: `This folder has no Zitadel server of its own, so doctor checked the one in the parent folder, ${parent.path}, and found a problem with it. To keep using it, fix it or start it again. To give this folder its own server, run start here instead. Resetting deletes the local data in ${parent.path}, not in this folder.`,
            next_commands: [
              expectedPublicCliCommand(`start --cwd ${Cmd.quote(parent.path)}`),
              expectedPublicCliCommand(`start --cwd ${Cmd.quote(app.path)}`),
              expectedPublicCliCommand(`reset --force --cwd ${Cmd.quote(parent.path)}`),
            ],
            details: {
              title: "Zitadel doctor found issues",
              ok: false,
              runtime: "binary",
              port: expect.any(Number),
              project: { lifecycle: "not-configured" },
              checks: [
                CHECK.cliVersion,
                CHECK.serverBinary,
                {
                  name: "state-dir",
                  status: "pass",
                  message: `${parent.path}/.zitadel/local/nextgen-data can be created (${parent.path}/.zitadel/local is writable)`,
                  category: "local_server",
                },
                CHECK.port,
                {
                  name: "runtime",
                  status: "fail",
                  message: expect.stringMatching(
                    /^http:\/\/localhost:\d+ is not ready: \/readyz did not answer ok$/,
                  ),
                  category: "local_server",
                },
                CHECK.processes,
              ],
              suggested_args: [
                ["start", "--cwd", parent.path],
                ["start", "--cwd", app.path],
                ["reset", "--force", "--cwd", parent.path],
              ],
            },
          });
        },
      );

      it.each(["my app", "it's"])(
        "quotes the directory in the commands that reset a malformed record and start it again (%s)",
        async (name) => {
          const parent = await parentNamed(name);
          await parent.writeMalformedServerRecord();
          const app = await parent.appInside("my-app");

          const result = await app.doctorAtItsServer();

          expect(app.envelopeOf(result)).toEqual({
            status: "error",
            cli_version: CLI_VERSION,
            command: "doctor",
            source: "http://localhost:8080",
            code: "E_VALIDATION",
            message: ".zitadel/local/runtime.json is malformed",
            hint: RESET_AND_START_HINT,
            next_commands: [
              expectedPublicCliCommand(`reset --force --cwd ${Cmd.quote(parent.path)}`),
              expectedPublicCliCommand(`start --cwd ${Cmd.quote(parent.path)}`),
            ],
            details: {
              x: 1,
              suggested_args: [
                ["reset", "--force", "--cwd", parent.path],
                ["start", "--cwd", parent.path],
              ],
            },
          });
        },
      );
    });
  });
});
