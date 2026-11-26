import { describe, expect, it } from "vitest";

import { orcaRefusal } from "@/cli/commands/setup/shared";
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

/**
 * The note every conflict `--force` cannot settle ends with.
 */
const FORCE_NOTE = "--force can't fix this: it only replaces files at the paths setup writes.";

describe("orcaRefusal", () => {
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
      new OrcaFileOverwriteError("Refusing to overwrite app/login/page.tsx", "app/login/page.tsx"),
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
      new OrcaBoundaryVersionUnknownError("Next.js 16 will not start", "proxy.ts", "middleware.ts"),
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
  ])("refuses %s", (_situation, error, refusal) => {
    expect(orcaRefusal(error)).toMatchObject(refusal);
  });

  it("leaves an error it does not word as it was", () => {
    const error = new Error("unanticipated");

    expect(orcaRefusal(error)).toBe(error);
  });
});
