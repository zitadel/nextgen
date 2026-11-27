import { Command, Config } from "@oclif/core";
import { describe, expect } from "vitest";

import { ErrorSupport } from "@/cli/core/error-support";
import { BackendTimeoutError, BackendUnreachableError } from "@/lib/backend";
import { EnvironmentValueMissingError } from "@/lib/environment";
import { ZitadelError } from "@/lib/errors";
import {
  OrcaAngularJsonMissingError,
  OrcaBoundaryDuplicateError,
  OrcaBoundaryRenamedError,
  OrcaBoundaryVersionUnknownError,
  OrcaConfigFileMissingError,
  OrcaFileOverwriteError,
  OrcaFrameworkUnknownError,
  OrcaPackageJsonMissingError,
  OrcaRendererPendingError,
  OrcaRootComponentMountError,
  OrcaSolidStartConfigMissingError,
  OrcaSvelteKitEnvVarsError,
  OrcaZitadelConfigMissingError,
} from "@/lib/orca";
import { ProjectConfigMissingError } from "@/lib/project";
import { FsNotFoundError } from "@/lib/fs";
import { LocalServerNotRespondingError, LocalServerRecordMalformedError } from "@/lib/server";
import {
  BackendMethodMismatchError,
  BackendNameUnknownError,
  BackendOperationAmbiguousError,
  BackendOperationUnknownError,
  BackendPathUnknownError,
  BackendVariablePreviewMissingError,
  BackendVariablePrimaryMissingError,
} from "@/lib/backend";
import { ConsentRequiredError } from "@/lib/consent";
import {
  EnvironmentNameInvalidError,
  EnvironmentSourcesConflictError,
  EnvironmentValueUnboundError,
} from "@/lib/environment";
import { FsExistsError } from "@/lib/fs";
import {
  IdpSettingsInvalidError,
  IdpSettingsMissingError,
  IdpSettingsUnusedError,
} from "@/lib/idp";
import {
  OrcaDirectoryNotEmptyError,
  OrcaFrameworkMismatchError,
  OrcaFrameworkMissingError,
  OrcaNodeUnsupportedError,
} from "@/lib/orca";
import { ProjectSecretMissingError } from "@/lib/project";
import {
  PublishConnectionSecretLiteralError,
  PublishApplicationSecretMissingError,
  PublishApplicationSecretPlainError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
} from "@/lib/publish";
import {
  LocalServerAdminMalformedError,
  LocalServerAdminNotFoundError,
  LocalServerAdminUnreadableError,
  LocalServerDockerFailedError,
  LocalServerDockerMissingError,
  LocalServerLaunchFailedError,
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRunningError,
  LocalServerNotStartedError,
  LocalServerPackageMissingError,
  LocalServerPlatformMissingError,
  LocalServerPortBusyError,
  LocalServerPortFullError,
  LocalServerProcessesUnlistableError,
  LocalServerSessionRefusedError,
  LocalServerStartCleanupFailedError,
  LocalServerStartExitedError,
  LocalServerStartTimeoutError,
  LocalServerStopAllFailedError,
} from "@/lib/server";
import {
  ZitadelConfigActionClashError,
  ZitadelConfigFlowMethodInUseError,
  ZitadelConfigFlowUncheckedError,
  ZitadelConfigNothingToDeployError,
  ZitadelConfigPasswordPolicyInvalidError,
  ZitadelConfigRenameRouteLossError,
  ZitadelConfigSignupPolicyInvalidError,
} from "@/lib/zitadel";
import { it } from "@tests/fixtures";
import { aSuggest } from "@tests/helpers/suggestions";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

/** A command that only exposes what the mixin gives it. */
class Wording extends ErrorSupport(Command) {
  /**
   * Does nothing, as a command that only words errors.
   */
  public async run(): Promise<void> {}

  /**
   * Words what a command threw.
   *
   * @param error - What it threw.
   * @param cwd - The folder the run acts on.
   * @returns What the run reports.
   */
  public wording(error: unknown, cwd: string): unknown {
    return this.worded(error, cwd);
  }
}

/**
 * A command with the error support, built against the CLI's own config.
 *
 * @returns The command.
 */
async function aWordingCommand(): Promise<Wording> {
  return new Wording([], await Config.load(cliPackageRoot));
}

/** Renders the commands a refusal suggests, as a run does. */
const suggest = aSuggest();

/** The folder the sample run acts on. */
const CWD = "/work/app";

/** The local server every sample names. */
const SERVER_URL = "http://localhost:8080";

/**
 * The note every conflict `--force` cannot settle ends with.
 */
const FORCE_NOTE = "--force can't fix this: it only replaces files at the paths setup writes.";

describe("ErrorSupport", () => {
  describe("with a lib error that has a wording", () => {
    it("says its message, hint and next commands", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new ProjectConfigMissingError("zitadel.json was not found"),
        CWD,
      );

      expect(reported).toMatchObject({
        code: "E_VALIDATION",
        message: "zitadel.json was not found",
        hint: "Set the project up first.",
        nextCommands: [{ id: "setup" }],
      });
    });

    it("keeps the code the error reports", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerNotRespondingError("The local server does not answer", SERVER_URL),
        CWD,
      );

      expect(reported).toMatchObject({ code: "E_LOCAL_SERVER_NOT_RUNNING" });
    });

    it("reports the error's own facts as details", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerNotRespondingError("The local server does not answer", SERVER_URL),
        CWD,
      );

      expect(reported).toMatchObject({ details: { server_url: SERVER_URL } });
    });

    it("keeps the error's own hint where the wording names only next commands", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new ProjectConfigMissingError("zitadel.json was not found"),
        CWD,
      );

      expect(reported).toMatchObject({ hint: "Set the project up first." });
    });

    it("names the flag that picks the server of one that cannot be reached", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new BackendUnreachableError("GET https://acme.zitadel.cloud got no response", {
          url: "https://acme.zitadel.cloud",
        }),
        CWD,
      );

      expect(reported).toMatchObject({
        hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
        details: { url: "https://acme.zitadel.cloud", reason: "unreachable" },
      });
    });

    it("fills its hint from what it works out of the error", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new EnvironmentValueMissingError("ZITADEL_URL is not set for the ci environment", {
          environment: "ci",
          variable: "ZITADEL_URL",
          consulted: ["process environment", ".env.ci.local"],
          file: ".env.ci.local",
        }),
        CWD,
      );

      expect(reported).toMatchObject({
        hint: "Consulted, in order: process environment, .env.ci.local. Set ZITADEL_URL in .env.ci.local or the process environment.",
      });
    });

    it.each([
      [
        "the folder the run acts on",
        CWD,
        [{ id: "reset", flags: { force: true } }, { id: "start" }],
      ],
      [
        "another folder",
        "/work",
        [
          { id: "reset", flags: { force: true, cwd: "/work" } },
          { id: "start", flags: { cwd: "/work" } },
        ],
      ],
    ] as const)("aims its follow-ups at a record held in %s", async (_where, directory, next) => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerRecordMalformedError(".zitadel/local/runtime.json is malformed", directory),
        CWD,
      );

      expect(reported).toMatchObject({ nextCommands: next });
    });

    it("is a refusal the run reports", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new ProjectConfigMissingError("zitadel.json was not found"),
        CWD,
      );

      expect(reported).toBeInstanceOf(ZitadelError);
    });
  });

  describe("with an orca error", () => {
    it.each<[string, Error, object]>([
      [
        "an Angular app with no angular.json",
        new OrcaAngularJsonMissingError("Cannot wire Angular proxy: angular.json not found"),
        {
          code: "E_VALIDATION",
          hint: "Run setup from an Angular project.",
        },
      ],
      [
        "a project with no package.json",
        new OrcaPackageJsonMissingError("package.json is required to pin the dev port"),
        {
          code: "E_VALIDATION",
          hint: "Run setup from a project that has a package.json.",
        },
      ],
      [
        "a project with no zitadel.json",
        new OrcaZitadelConfigMissingError("zitadel.json was not found"),
        {
          code: "E_VALIDATION",
          hint: "Run `zitadel setup` first.",
        },
      ],
      [
        "a file it would overwrite",
        new OrcaFileOverwriteError(
          "Refusing to overwrite app/login/page.tsx",
          "app/login/page.tsx",
        ),
        {
          code: "E_CONFLICT",
          hint: "Rerun with --force if you want the CLI to replace this file.",
          details: { path: "app/login/page.tsx" },
        },
      ],
      [
        "a boundary under the name it writes",
        new OrcaBoundaryDuplicateError("Next.js runs one proxy file", "src/proxy.ts", "proxy.ts"),
        {
          code: "E_CONFLICT",
          hint: `Setup writes proxy.ts, and one of the two would never run. Move src/proxy.ts aside and rerun setup, then merge it into proxy.ts. ${FORCE_NOTE}`,
          details: { path: "src/proxy.ts", writes: "proxy.ts" },
        },
      ],
      [
        "a middleware beside the proxy it writes",
        new OrcaBoundaryRenamedError("Next.js 16 will not start", "middleware.ts", "proxy.ts"),
        {
          code: "E_CONFLICT",
          hint: `Next.js 16 renamed middleware.ts to proxy.ts. Move middleware.ts aside and rerun setup, then merge it into proxy.ts. ${FORCE_NOTE}`,
          details: { path: "middleware.ts", writes: "proxy.ts" },
        },
      ],
      [
        "a boundary in an app of unknown Next.js version",
        new OrcaBoundaryVersionUnknownError(
          "Next.js 16 will not start",
          "proxy.ts",
          "middleware.ts",
        ),
        {
          code: "E_CONFLICT",
          hint: `Setup reads no Next.js version from package.json (a tag such as "latest" names none), so it writes the middleware.ts of Next 15. Pin next to the version range the app runs, such as "^16.0.0", and rerun setup: on Next 16 it then writes proxy.ts, and on Next 15 it leaves your proxy.ts alone. ${FORCE_NOTE}`,
          details: { path: "proxy.ts", writes: "middleware.ts" },
        },
      ],
      [
        "a renderer that is not published",
        new OrcaRendererPendingError('Renderer "web-component" is declared but not yet published'),
        {
          code: "E_NOT_IMPLEMENTED",
          hint: "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
        },
      ],
      [
        "an entry that mounts another root",
        new OrcaRootComponentMountError(
          "src/main.tsx mounts src/Root.tsx, not the src/App.tsx setup writes",
          {
            entry: "src/main.tsx",
            mountedRoot: "src/Root.tsx",
            root: "src/App.tsx",
            statement: 'import App from "./App.tsx";',
          },
        ),
        {
          code: "E_CONFLICT",
          message: "src/main.tsx mounts src/Root.tsx, not the src/App.tsx setup writes",
          hint: `Your app would keep loading src/Root.tsx, and the root component setup writes would never run. In src/main.tsx, import the root as \`import App from "./App.tsx";\` and mount that instead, then rerun setup and move what you need from src/Root.tsx into src/App.tsx. ${FORCE_NOTE}`,
          details: { path: "src/Root.tsx", entry: "src/main.tsx", writes: "src/App.tsx" },
        },
      ],
      [
        "a SolidStart app with no Vite config",
        new OrcaSolidStartConfigMissingError(
          "Cannot edit the SolidStart Vite config: file not found",
        ),
        {
          code: "E_VALIDATION",
          hint: "Run setup from a SolidStart project that has a vite.config.ts.",
        },
      ],
      [
        "a SvelteKit env module with no variables it reads",
        new OrcaSvelteKitEnvVarsError(
          "Could not find the env variables src/env.ts declares",
          "src/env.ts",
          "ZITADEL_URL, ZITADEL_PROJECT_ID",
        ),
        {
          code: "E_VALIDATION",
          hint: "Export them as `export const variables = defineEnvVars({ ... })` from @sveltejs/kit/env, or declare ZITADEL_URL, ZITADEL_PROJECT_ID there by hand.",
        },
      ],
      [
        "a config module that is not there",
        new OrcaConfigFileMissingError(
          "Cannot edit nuxt.config.ts: file not found",
          "nuxt.config.ts",
        ),
        {
          code: "E_VALIDATION",
          hint: "Run setup from a project that has nuxt.config.ts.",
        },
      ],
    ])("refuses %s", async (_situation, error, refusal) => {
      const command = await aWordingCommand();

      expect(command.wording(error, CWD)).toMatchObject(refusal);
    });
  });

  describe("with each wording", () => {
    /** A local server start that failed, as each start failure carries it. */
    const STARTED = {
      serverUrl: SERVER_URL,
      runtime: "binary",
      pid: 42,
      logPath: "/work/app/.zitadel/local/server.log",
    };

    /** What `api ls --json` suggests next. */
    const API_LS = [{ id: "api:ls", flags: { json: true } }];

    it.each<[string, Error, { hint: string | undefined; nextCommands: unknown }]>([
      [
        "a variable with no preview value",
        new BackendVariablePreviewMissingError("API_URL has no preview value"),
        {
          hint: "A name has a preview value only once one is set with `--preview`.",
          nextCommands: undefined,
        },
      ],
      [
        "a variable with no primary value",
        new BackendVariablePrimaryMissingError("API_URL has no primary value"),
        { hint: "Set one with `zitadel variable set`.", nextCommands: undefined },
      ],
      [
        "a path no operation matches",
        new BackendPathUnknownError("No operation at /nope"),
        { hint: "List the paths with `zitadel api ls`.", nextCommands: API_LS },
      ],
      [
        "an operation near others",
        new BackendOperationUnknownError("No operation getUsr", ["getUser", "getUsers"]),
        {
          hint: "Did you mean getUser, getUsers? List them all with `zitadel api ls`.",
          nextCommands: API_LS,
        },
      ],
      [
        "an operation near none",
        new BackendOperationUnknownError("No operation xyz"),
        {
          hint: "List them with `zitadel api ls`, or give a path such as /users/query.",
          nextCommands: API_LS,
        },
      ],
      [
        "a method the path does not take",
        new BackendMethodMismatchError("GET is not served at /users/query", "POST"),
        { hint: "Leave out -X, or pass -X POST.", nextCommands: API_LS },
      ],
      [
        "a path several methods serve",
        new BackendOperationAmbiguousError("/users serves several methods", ["GET", "POST"]),
        { hint: "Pass -X with one of GET, POST.", nextCommands: API_LS },
      ],
      [
        "a flow name no flow carries",
        new BackendNameUnknownError('No flow definition named "x"', "flow", "x"),
        {
          hint: "Run `flow-definition list` to see the flows this project has.",
          nextCommands: undefined,
        },
      ],
      [
        "a schema name no schema carries",
        new BackendNameUnknownError('No schema named "x"', "schema", "x"),
        {
          hint: "Run `schema list` to see the object types this project has.",
          nextCommands: undefined,
        },
      ],
      [
        "consent nobody can give, with a retry",
        new ConsentRequiredError(
          "Cannot delete it without --force",
          "Delete?",
          suggest({ id: "reset", flags: { force: true } }),
        ),
        {
          hint: "Ask a person first: Delete? Pass --force only once they agree.",
          nextCommands: ["npx @zitadel/cli@0.1.0 reset --force"],
        },
      ],
      [
        "consent nobody can give, with no retry",
        new ConsentRequiredError("Cannot delete it without --force", "Delete?"),
        {
          hint: "Ask a person first: Delete? Pass --force only once they agree.",
          nextCommands: undefined,
        },
      ],
      [
        "two environment sources at once",
        new EnvironmentSourcesConflictError("--env and --env-file both given", "--env"),
        {
          hint: "--env picks the .env.<name>.local files; --env-file names one file outright.",
          nextCommands: undefined,
        },
      ],
      [
        "an unsafe environment name",
        new EnvironmentNameInvalidError("The environment name ../x is not safe", "--env"),
        {
          hint: 'The --env environment name may use only letters, digits, dot, dash and underscore, may not contain "..", and may not be `local` or end in `.local`. Pass a safe --env or set ZITADEL_ENV.',
          nextCommands: undefined,
        },
      ],
      [
        "a development value bound nowhere",
        new EnvironmentValueUnboundError("ZITADEL_URL is not set", {
          environment: "development",
          variable: "ZITADEL_URL",
          consulted: ["process environment", ".env.development.local"],
          file: ".env.development.local",
        }),
        {
          hint: "Consulted, in order: process environment, .env.development.local. Set ZITADEL_URL in .env.development.local or the process environment, or run `zitadel env add development`.",
          nextCommands: [{ id: "setup", flags: { cwd: CWD } }],
        },
      ],
      [
        "another environment's value bound nowhere",
        new EnvironmentValueUnboundError("ZITADEL_URL is not set", {
          environment: "ci",
          variable: "ZITADEL_URL",
          consulted: ["process environment"],
          file: ".env.ci.local",
        }),
        {
          hint: "Consulted, in order: process environment. Set ZITADEL_URL in .env.ci.local or the process environment, or run `zitadel env add ci`.",
          nextCommands: [{ id: "env:add", args: { name: "ci" }, flags: { cwd: CWD } }],
        },
      ],
      [
        "a file that is there already",
        new FsExistsError("EEXIST: file already exists"),
        {
          hint: "A file already exists. Use --force to overwrite or remove it first.",
          nextCommands: undefined,
        },
      ],
      [
        "an invalid connection flag",
        new IdpSettingsInvalidError("--issuer", "is not a URL"),
        { hint: "Fix --issuer and run the command again.", nextCommands: undefined },
      ],
      [
        "one flag no provider uses",
        new IdpSettingsUnusedError(["--issuer"], "--provider"),
        { hint: "Add --provider custom, or remove it.", nextCommands: undefined },
      ],
      [
        "flags no provider uses",
        new IdpSettingsUnusedError(["--issuer", "--scopes"], "--provider"),
        { hint: "Add --provider custom, or remove them.", nextCommands: undefined },
      ],
      [
        "a connection described by nothing",
        new IdpSettingsMissingError(["--issuer"], "--issuer https://idp.example"),
        {
          hint: "Describe the connection, e.g. --issuer https://idp.example",
          nextCommands: undefined,
        },
      ],
      [
        "a framework other than the one detected",
        new OrcaFrameworkMismatchError("Asked for vue in a next app", "vue", "next", "Vue"),
        {
          hint: "Rerun setup without --framework, or with --framework next, to set up this app, or point --cwd at the Vue app you meant. Setup never scaffolds a new app over one it detects, --force or not.",
          nextCommands: undefined,
        },
      ],
      [
        "a directory that is not empty",
        new OrcaDirectoryNotEmptyError("The directory is not empty", "It holds files.", ["a"]),
        {
          hint: "It holds files. Pass --force to scaffold into a non-empty directory, or run setup from an existing supported app project.",
          nextCommands: undefined,
        },
      ],
      [
        "a Node version the framework does not take",
        new OrcaNodeUnsupportedError("Node 18 is too old", "18.0.0", ">=20", "20 or 22", "Nuxt"),
        {
          hint: "Switch to Node 20 or 22 and rerun, or create the Nuxt app with that Node and run setup inside it.",
          nextCommands: undefined,
        },
      ],
      [
        "no framework at all",
        new OrcaFrameworkMissingError("No supported framework was found"),
        {
          hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
          nextCommands: undefined,
        },
      ],
      [
        "a project secret that is missing",
        new ProjectSecretMissingError(".zitadel/secret was not found"),
        {
          hint: "Run `zitadel doctor --fix` to restore the project secret from .env.development.local.",
          nextCommands: [{ id: "doctor", flags: { fix: true } }],
        },
      ],
      [
        "a secret written as a literal",
        new PublishConnectionSecretLiteralError("google.json holds a secret", [], false),
        {
          hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".',
          nextCommands: [{ id: "variable:set", args: { name: "NAME" }, flags: { secret: true } }],
        },
      ],
      [
        "a secret literal under a key a newer server added",
        new PublishConnectionSecretLiteralError("google.json holds a secret", [], true),
        {
          hint: 'Publish a secret with the command below and reference it as "${{ NAME }}". A key a newer Zitadel server added needs a CLI as new as the server.',
          nextCommands: [{ id: "variable:set", args: { name: "NAME" }, flags: { secret: true } }],
        },
      ],
      [
        "an application secret the project does not hold",
        new PublishApplicationSecretMissingError({
          variable: "SHOP_SECRET",
          client: "web",
          file: ".zitadel/applications/shop.json",
          preview: false,
        }),
        {
          hint: "Publish it as a secret with the command below, then deploy again.",
          nextCommands: [
            {
              id: "variable:set",
              args: { name: "SHOP_SECRET" },
              flags: { secret: true, preview: false },
            },
          ],
        },
      ],
      [
        "an application secret held as a plain value",
        new PublishApplicationSecretPlainError({
          variable: "SHOP_SECRET",
          client: "web",
          file: ".zitadel/applications/shop.json",
          preview: true,
        }),
        {
          hint: "A client secret must be a secret variable: publish it with the command below.",
          nextCommands: [
            {
              id: "variable:set",
              args: { name: "SHOP_SECRET" },
              flags: { secret: true, preview: true },
            },
          ],
        },
      ],
      [
        "a variable a connection names that is not published",
        new PublishConnectionVariableMissingError("GOOGLE_SECRET is not published", {
          variable: "GOOGLE_SECRET",
          field: "client_secret",
          file: ".zitadel/idps/google.json",
          secret: true,
          preview: false,
        }),
        {
          hint: "Publish it with the command below, then deploy again.",
          nextCommands: [
            {
              id: "variable:set",
              args: { name: "GOOGLE_SECRET" },
              flags: { secret: true, preview: false },
            },
          ],
        },
      ],
      [
        "a client secret published as a plain variable",
        new PublishConnectionVariableKindError("GOOGLE_SECRET is not a secret", {
          variable: "GOOGLE_SECRET",
          field: "client_secret",
          file: ".zitadel/idps/google.json",
          secret: true,
          preview: false,
        }),
        {
          hint: "The client secret must be a secret variable: publish it with the command below.",
          nextCommands: [
            {
              id: "variable:set",
              args: { name: "GOOGLE_SECRET" },
              flags: { secret: true, preview: false },
            },
          ],
        },
      ],
      [
        "a client id published as a secret",
        new PublishConnectionVariableKindError("GOOGLE_ID is a secret", {
          variable: "GOOGLE_ID",
          field: "client_id",
          file: ".zitadel/idps/google.json",
          secret: false,
          preview: true,
        }),
        {
          hint: "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
          nextCommands: [
            {
              id: "variable:set",
              args: { name: "GOOGLE_ID" },
              flags: { secret: false, preview: true },
            },
          ],
        },
      ],
      [
        "no local server started here",
        new LocalServerNotRunningError("No local server is running", SERVER_URL),
        {
          hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>.",
          nextCommands: [{ id: "start" }],
        },
      ],
      [
        "a local server started elsewhere that does not answer",
        new LocalServerNotRespondingElsewhereError("It does not answer", "/work", SERVER_URL),
        {
          hint: `No healthy local server responded at ${SERVER_URL}. It was started in /work, so run \`zitadel start --cwd /work\` to bring it back.`,
          nextCommands: [{ id: "start", flags: { cwd: "/work" } }],
        },
      ],
      [
        "a local server not started",
        new LocalServerNotStartedError("The local server was not started"),
        { hint: "Run `zitadel start` first.", nextCommands: [{ id: "start" }] },
      ],
      [
        "a local runtime record malformed here",
        new LocalServerRecordMalformedError("runtime.json is malformed", CWD),
        {
          hint: "Run `zitadel reset --force`, then `zitadel start`.",
          nextCommands: [{ id: "reset", flags: { force: true } }, { id: "start" }],
        },
      ],
      [
        "a local runtime record malformed elsewhere",
        new LocalServerRecordMalformedError("runtime.json is malformed", "/work"),
        {
          hint: "Reset the local runtime, then start it again, each with the --cwd of the directory that holds it.",
          nextCommands: [
            { id: "reset", flags: { force: true, cwd: "/work" } },
            { id: "start", flags: { cwd: "/work" } },
          ],
        },
      ],
      [
        "a local admin file it cannot read",
        new LocalServerAdminUnreadableError(
          "admin.json cannot be read",
          "/work/app/admin.json",
          new Error("EACCES"),
        ),
        {
          hint: "Check that /work/app/admin.json is readable by you; `zitadel start` writes it owner-only.",
          nextCommands: undefined,
        },
      ],
      [
        "a malformed local admin file",
        new LocalServerAdminMalformedError("admin.json is malformed", "/work/app/admin.json", CWD),
        {
          hint: "Delete /work/app/admin.json and run `zitadel reset --force`, then `zitadel start`. Both are needed: reset keeps the file, and deleting it alone leaves the server holding the old password.",
          nextCommands: [
            "rm /work/app/admin.json",
            { id: "reset", flags: { force: true } },
            { id: "start" },
          ],
        },
      ],
      [
        "a local admin the server does not know",
        new LocalServerAdminNotFoundError("The local admin was not found", 404),
        {
          hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
          nextCommands: [{ id: "logs" }],
        },
      ],
      [
        "a session the local server refused",
        new LocalServerSessionRefusedError("The local server refused the session", 403),
        {
          hint: "Check `zitadel logs` for why the local server refused the admin's session.",
          nextCommands: undefined,
        },
      ],
      [
        "a missing server package",
        new LocalServerPackageMissingError(
          "@zitadel/server is missing",
          "@zitadel/server",
          new Error("gone"),
        ),
        {
          hint: "Reinstall @zitadel/cli so npm can install @zitadel/server and its platform package.",
          nextCommands: ["npm install @zitadel/cli@latest"],
        },
      ],
      [
        "a server binary that would not launch",
        new LocalServerLaunchFailedError(
          "The server did not launch",
          "/bin/zitadel",
          new Error("ENOENT"),
        ),
        {
          hint: "Check that the server binary exists and can be run, or reinstall @zitadel/cli.",
          nextCommands: ["npm install @zitadel/cli@latest"],
        },
      ],
      [
        "a Docker command that failed",
        new LocalServerDockerFailedError("docker run failed", ["docker", "run"], "no such image"),
        {
          hint: "Check that Docker is installed, running, and reachable from this shell.",
          nextCommands: [{ id: "doctor" }],
        },
      ],
      [
        "no Docker",
        new LocalServerDockerMissingError("Docker is not installed", "docker: not found"),
        {
          hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
          nextCommands: [{ id: "doctor" }],
        },
      ],
      [
        "a server without the platform project",
        new LocalServerPlatformMissingError("The platform project is missing", SERVER_URL),
        {
          hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
          nextCommands: [{ id: "stop" }, { id: "start" }],
        },
      ],
      [
        "servers stop --all could not stop",
        new LocalServerStopAllFailedError("Some servers did not stop", []),
        {
          hint: "Inspect the failed process IDs and stop them manually, then rerun `zitadel stop --all`.",
          nextCommands: undefined,
        },
      ],
      [
        "no free port",
        new LocalServerPortFullError("No port is free", 8080),
        {
          hint: "Free a port, or pick one with `zitadel start --port <port>`.",
          nextCommands: undefined,
        },
      ],
      [
        "a port that is held",
        new LocalServerPortBusyError(8080),
        {
          hint: "Stop whatever holds the port, or pick another with `zitadel start --port <port>`.",
          nextCommands: undefined,
        },
      ],
      [
        "a start it could not clean up after",
        new LocalServerStartCleanupFailedError("The server did not start", STARTED, "exited", {}),
        {
          hint: "Inspect the local runtime process and stop it manually, then rerun `zitadel start`.",
          nextCommands: [
            { id: "logs" },
            { id: "reset", flags: { force: true } },
            { id: "stop", flags: { all: true } },
          ],
        },
      ],
      [
        "a server that exited on start",
        new LocalServerStartExitedError("The server exited", STARTED),
        {
          hint: "Read `zitadel logs` for why the server did not become healthy, then run `zitadel start` again.",
          nextCommands: [{ id: "logs" }, { id: "start" }],
        },
      ],
      [
        "a server that timed out on start",
        new LocalServerStartTimeoutError("The server timed out", STARTED),
        {
          hint: "Read `zitadel logs` for why the server did not become healthy, then run `zitadel start` again.",
          nextCommands: [{ id: "logs" }, { id: "start" }],
        },
      ],
      [
        "processes it cannot list",
        new LocalServerProcessesUnlistableError("Cannot list processes", "ps failed"),
        {
          hint: "The local runtime record is damaged and this machine cannot list its processes, so reset cannot tell whether a server still runs on the data. Stop the local Zitadel server yourself, then run `zitadel reset --force` again.",
          nextCommands: undefined,
        },
      ],
      [
        "a method a flow still uses",
        new ZitadelConfigFlowMethodInUseError("The flow uses password", {
          file: ".zitadel/flows/login.json",
          method: "password",
          issues: [],
          uses: [],
        }),
        {
          hint: "Edit those steps first; login flows are not edited for you. From each step, remove its x-auth-methods#password field. `zitadel deploy --dry-run` checks the edited flow; then run the command again.",
          nextCommands: [{ id: "deploy", flags: { dryRun: true } }],
        },
      ],
      [
        "a flow that does not check out",
        new ZitadelConfigFlowUncheckedError("The flow has errors", {
          file: ".zitadel/flows/login.json",
          issues: [],
        }),
        {
          hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
          nextCommands: [{ id: "deploy", flags: { dryRun: true } }],
        },
      ],
      [
        "nothing to deploy",
        new ZitadelConfigNothingToDeployError(),
        {
          hint: "Add a schema, flow, policy, branding, application or OAuth settings under .zitadel/, or run `zitadel setup` to scaffold one.",
          nextCommands: undefined,
        },
      ],
      [
        "a password policy that is not sound",
        new ZitadelConfigPasswordPolicyInvalidError(".zitadel/policies/password.json"),
        {
          hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
          nextCommands: undefined,
        },
      ],
      [
        "a sign-up policy that is not sound",
        new ZitadelConfigSignupPolicyInvalidError(".zitadel/policies/user.create.json"),
        {
          hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from the default.",
          nextCommands: undefined,
        },
      ],
      [
        "an action that clashes",
        new ZitadelConfigActionClashError("The action sso clashes", "start", "sso"),
        {
          hint: 'Rename the action "sso" on step "start" (and its transition), then run `zitadel auth-method sso enable` again.',
          nextCommands: undefined,
        },
      ],
      [
        "a rename that would lose a route",
        new ZitadelConfigRenameRouteLossError("start", "to-sso", "sso"),
        {
          hint: 'Remove purpose and action from the transition "to-sso" on step "start", then run `zitadel auth-method sso enable` again.',
          nextCommands: undefined,
        },
      ],
    ])("advises on %s", async (_situation, error, advice) => {
      const command = await aWordingCommand();

      const reported = command.wording(error, CWD);

      expect(reported).toMatchObject({ hint: advice.hint });
      expect(reported).toHaveProperty("nextCommands", advice.nextCommands);
    });
  });

  describe("with an error it has no wording for", () => {
    it.each([
      ["the server's answer", new BackendTimeoutError("timed out")],
      ["an error nobody anticipated", new TypeError("boom")],
      ["a lib error whose advice names no command", new FsNotFoundError("ENOENT: no such file")],
      [
        "a subclass of a class with a wording",
        new OrcaFrameworkUnknownError('Unsupported framework "ember"', "next, react"),
      ],
    ] as const)("leaves %s as it was thrown", async (_what, error) => {
      const command = await aWordingCommand();

      const reported = command.wording(error, CWD);

      expect(reported).toBe(error);
    });
  });
});
