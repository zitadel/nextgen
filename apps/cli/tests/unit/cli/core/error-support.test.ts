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
import { it } from "@tests/fixtures";
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
