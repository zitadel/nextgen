import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, Config } from "@oclif/core";
import ts from "typescript";
import { describe, expect } from "vitest";

import { ErrorSupport } from "@/cli/core/error-support";
import { WORDINGS } from "@/cli/core/error-support/index";
import { BackendTimeoutError } from "@/lib/backend";
import { EnvironmentValueMissingError } from "@/lib/environment";
import { ZitadelError } from "@/lib/errors";
import {
  OrcaAngularJsonMissingError,
  OrcaAngularProjectAmbiguousError,
  OrcaAngularRoutesNotInlineError,
  OrcaBoundaryDuplicateError,
  OrcaBoundaryRenamedError,
  OrcaBoundaryVersionUnknownError,
  OrcaConfigArrayExpectedError,
  OrcaConfigCommonJsError,
  OrcaConfigFileMissingError,
  OrcaConfigObjectExpectedError,
  OrcaConfigObjectMissingError,
  OrcaConfigUnparseableError,
  OrcaConfigUnwritableError,
  OrcaFileOverwriteError,
  OrcaFrameworkUnknownError,
  OrcaPackageJsonMissingError,
  OrcaPatcherMissingError,
  OrcaPatchOpEmptyError,
  OrcaProxyCredentialLeakError,
  OrcaRendererPendingError,
  OrcaRendererUnknownError,
  OrcaRootComponentMountError,
  OrcaSolidStartConfigMissingError,
  OrcaSolidStartPluginMissingError,
  OrcaSvelteKitEnvVarsError,
  OrcaZitadelConfigMissingError,
} from "@/lib/orca";
import { ProjectConfigMissingError } from "@/lib/project";
import { LocalServerBusyError, LocalServerRecordMalformedError } from "@/lib/server";
import { it } from "@tests/fixtures";
import { nodesOf, parsedFile, sourcesUnder } from "@tests/helpers/declarations";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

const lib = fileURLToPath(new URL("../../../../src/lib", import.meta.url));

/**
 * The lib errors that have no wording, each with why: a bug in the CLI's own
 * code, which is not a refusal to word, or an error that never leaves the
 * code that raises it.
 */
const UNWORDED: ReadonlyMap<string, string> = new Map<string, string>();

/**
 * The lib error families worded elsewhere, each with where: every class that
 * extends one is too.
 */
const WORDED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["BackendError", "the server's answer, which toZitadelError words by its status and body"],
]);

/** A class declared under `src/lib`: the class it extends, and whether it is abstract. */
type Declared = Readonly<{
  parent: string | undefined;
  abstract: boolean;
}>;

/**
 * Every class declared under `src/lib`, by name.
 *
 * @returns The classes.
 */
async function libClasses(): Promise<ReadonlyMap<string, Declared>> {
  const found = new Map<string, Declared>();
  for (const file of await sourcesUnder(lib)) {
    const source = await parsedFile(join(lib, file));
    for (const declaration of nodesOf(source, ts.isClassDeclaration)) {
      if (declaration.name === undefined) {
        continue;
      }
      const extended = declaration.heritageClauses
        ?.find((clause) => {
          return clause.token === ts.SyntaxKind.ExtendsKeyword;
        })
        ?.types.at(0)?.expression;
      found.set(declaration.name.text, {
        parent: extended !== undefined && ts.isIdentifier(extended) ? extended.text : undefined,
        abstract: (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract) !== 0,
      });
    }
  }
  return found;
}

/**
 * `name` and every class it extends under `src/lib`, nearest first.
 *
 * @param classes - The classes under `src/lib`.
 * @param name - The class.
 * @returns The chain.
 */
function chainOf(classes: ReadonlyMap<string, Declared>, name: string | undefined): string[] {
  const declared = name === undefined ? undefined : classes.get(name);
  if (name === undefined || declared === undefined) {
    return [];
  }
  return [name, ...chainOf(classes, declared.parent)];
}

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

/**
 * The note every conflict `--force` cannot settle ends with.
 */
const FORCE_NOTE = "--force can't fix this: it only replaces files at the paths setup writes.";

describe("ErrorSupport", () => {
  it("words every lib error a command can let through", async () => {
    const classes = await libClasses();
    const worded = new Set(
      WORDINGS.map(([Class]) => {
        return Class.name;
      }),
    );

    const unworded = [...classes.entries()].flatMap(([name, declared]) => {
      const chain = chainOf(classes, name);
      if (declared.abstract || !chain.includes("ZitadelLibError") || UNWORDED.has(name)) {
        return [];
      }
      return chain.some((one) => {
        return worded.has(one) || WORDED_ELSEWHERE.has(one);
      })
        ? []
        : [name];
    });

    expect(unworded).toEqual([]);
  });

  it("allows only classes that exist", async () => {
    const classes = await libClasses();

    const unknown = [...UNWORDED.keys(), ...WORDED_ELSEWHERE.keys()].filter((name) => {
      return !classes.has(name);
    });

    expect(unknown).toEqual([]);
  });

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
        new LocalServerBusyError("Another start is running", "/work/app/.zitadel/start.lock", 42),
        CWD,
      );

      expect(reported).toMatchObject({ code: "E_CONFLICT" });
    });

    it("reports the error's own fields as details, keyed in snake_case", async () => {
      const command = await aWordingCommand();

      const reported = command.wording(
        new LocalServerBusyError("Another start is running", "/work/app/.zitadel/start.lock", 42),
        CWD,
      );

      expect(reported).toMatchObject({
        details: { lock_file: "/work/app/.zitadel/start.lock", owner_pid: 42 },
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
        "a framework orca has no detector for",
        new OrcaFrameworkUnknownError('Unsupported framework "ember"', "next, react"),
        {
          code: "E_FRAMEWORK_NOT_DETECTED",
          message: 'Unsupported framework "ember"',
          hint: "Supported frameworks: next, react.",
        },
      ],
      [
        "a framework with no patcher",
        new OrcaPatcherMissingError('No patcher supports "ember"'),
        {
          code: "E_VALIDATION",
          message: 'No patcher supports "ember"',
          hint: "Zitadel integration currently supports Next.js.",
        },
      ],
      [
        "an op with no path",
        new OrcaPatchOpEmptyError("An op needs at least one candidate path"),
        {
          code: "E_VALIDATION",
          hint: "This is an internal patcher error — please report it if you hit it.",
        },
      ],
      [
        "an Angular app with no angular.json",
        new OrcaAngularJsonMissingError("Cannot wire Angular proxy: angular.json not found"),
        {
          code: "E_VALIDATION",
          hint: "Run setup from an Angular project.",
        },
      ],
      [
        "an angular.json with no project to choose",
        new OrcaAngularProjectAmbiguousError("angular.json has multiple projects", "admin, shop"),
        {
          code: "E_VALIDATION",
          hint: 'Set "defaultProject" in angular.json, or add "proxyConfig" to the right project\'s serve target manually. Projects: admin, shop.',
        },
      ],
      [
        "Angular routes that are no inline array",
        new OrcaAngularRoutesNotInlineError(
          "Cannot wire Angular auth routes",
          "src/app/app.routes.ts",
        ),
        {
          code: "E_VALIDATION",
          hint: 'Set "routes" in src/app/app.routes.ts to an inline Routes array, or add /login, /register, and /profile manually.',
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
        "a renderer id that names none",
        new OrcaRendererUnknownError('Unknown renderer "vue"', "react"),
        {
          code: "E_VALIDATION",
          message: 'Unknown renderer "vue"',
          hint: "Available renderers: react.",
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
        "a proxy that may forward the project secret",
        new OrcaProxyCredentialLeakError(
          "proxy.conf.cjs may forward ZITADEL_PROJECT_SECRET outside POST /sessions/exchange",
          "/api/v1/sessions/exchange",
        ),
        {
          code: "E_VALIDATION",
          message:
            "proxy.conf.cjs may forward ZITADEL_PROJECT_SECRET outside POST /sessions/exchange",
          hint: "Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange or /api/v1/sessions/exchange pathname and preserve caller-provided authorization.",
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
        "a SolidStart Vite config with no solidStart() plugin",
        new OrcaSolidStartPluginMissingError("Cannot wire middleware"),
        {
          code: "E_VALIDATION",
          hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.",
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
      [
        "a config module that does not parse",
        new OrcaConfigUnparseableError(
          "Could not parse nuxt.config.ts",
          "nuxt.config.ts",
          "Unexpected token",
          new SyntaxError("Unexpected token"),
        ),
        {
          code: "E_VALIDATION",
          hint: "Ensure nuxt.config.ts is valid, or apply the Zitadel changes manually.",
          details: { cause: "Unexpected token" },
        },
      ],
      [
        "a config module written as CommonJS",
        new OrcaConfigCommonJsError("nuxt.config.ts is a CommonJS module", "nuxt.config.ts"),
        {
          code: "E_VALIDATION",
          hint: 'The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.',
        },
      ],
      [
        "a config module with no exported object",
        new OrcaConfigObjectMissingError("Could not locate the config object", "nuxt.config.ts"),
        {
          code: "E_VALIDATION",
          hint: "Add the Zitadel configuration to nuxt.config.ts manually (see the SDK README).",
        },
      ],
      [
        "a config key that holds no inline object",
        new OrcaConfigObjectExpectedError('Could not edit "zitadel" in the config', "zitadel"),
        {
          code: "E_VALIDATION",
          hint: 'Set "zitadel" to an inline object literal, or add the Zitadel settings manually.',
        },
      ],
      [
        "a config key that holds no inline array",
        new OrcaConfigArrayExpectedError('Could not edit "modules" in the config', "modules"),
        {
          code: "E_VALIDATION",
          hint: 'Set "modules" to an inline array literal, or add the Zitadel settings manually.',
        },
      ],
      [
        "an edit that would leave a config module unparseable",
        new OrcaConfigUnwritableError(
          "Could not write nuxt.config.ts",
          "nuxt.config.ts",
          "Unexpected token",
          new SyntaxError("Unexpected token"),
        ),
        {
          code: "E_VALIDATION",
          hint: "The edit left nuxt.config.ts unparseable, so apply the Zitadel changes manually.",
          details: { cause: "Unexpected token" },
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
    ] as const)("leaves %s as it was thrown", async (_what, error) => {
      const command = await aWordingCommand();

      const reported = command.wording(error, CWD);

      expect(reported).toBe(error);
    });
  });
});
