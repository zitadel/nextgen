import { describe, expect, it } from "vitest";

import {
  OrcaAngularProjectAmbiguousError,
  OrcaAngularRoutesNotInlineError,
  OrcaConfigArrayExpectedError,
  OrcaConfigCommonJsError,
  OrcaConfigObjectExpectedError,
  OrcaConfigObjectMissingError,
  OrcaConfigUnparseableError,
  OrcaConfigUnwritableError,
  OrcaConflictError,
  OrcaError,
  OrcaFrameworkMissingError,
  OrcaFrameworkUnknownError,
  OrcaFrameworkUnsupportedError,
  OrcaInternalError,
  OrcaInvalidError,
  OrcaPatchFileMissingError,
  OrcaPatchOpEmptyError,
  OrcaPatcherMissingError,
  OrcaProxyCredentialLeakError,
  OrcaRendererPendingError,
  OrcaRendererUnknownError,
  OrcaSolidStartPluginMissingError,
} from "@/lib/orca/errors";

import * as classes from "@/lib/orca/errors";

describe("OrcaError", () => {
  it("carries its message, name and cause", () => {
    const cause = new Error("underneath");

    const error = new OrcaInternalError("why", cause);

    expect(error).toBeInstanceOf(OrcaError);
    expect(error).toMatchObject({
      message: "why",
      name: "OrcaInternalError",
      code: "E_VALIDATION",
      category: "fault",
      cause,
    });
  });
});

describe("the orca errors", () => {
  it.each([
    [new OrcaFrameworkMissingError("why"), "OrcaFrameworkMissingError", "missing"],
    [new OrcaFrameworkUnsupportedError("why"), "OrcaFrameworkUnsupportedError", "invalid"],
    [new OrcaConflictError("why"), "OrcaConflictError", "conflict"],
    [new OrcaPatchFileMissingError("why"), "OrcaPatchFileMissingError", "missing"],
    [new OrcaInvalidError("why"), "OrcaInvalidError", "invalid"],
    [new OrcaRendererPendingError("why"), "OrcaRendererPendingError", "invalid"],
    [new OrcaInternalError("why"), "OrcaInternalError", "fault"],
  ])("is an OrcaError named %#", (error, name, category) => {
    expect(error).toBeInstanceOf(OrcaError);
    expect(error).toMatchObject({
      name,
      category,
    });
  });
});

describe("the orca errors' codes", () => {
  it.each([
    ["no app", new OrcaFrameworkMissingError("why"), "E_FRAMEWORK_NOT_DETECTED"],
    ["an unsupported app", new OrcaFrameworkUnsupportedError("why"), "E_UNSUPPORTED_PROJECT_SHAPE"],
    ["a conflict", new OrcaConflictError("why"), "E_CONFLICT"],
    ["an invalid request", new OrcaInvalidError("why"), "E_VALIDATION"],
    ["a missing file", new OrcaPatchFileMissingError("why"), "E_VALIDATION"],
    ["a pending renderer", new OrcaRendererPendingError("why"), "E_NOT_IMPLEMENTED"],
    ["a bug", new OrcaInternalError("why"), "E_VALIDATION"],
  ] as const)("reports %s as %s", (_name, error, code) => {
    expect(error.code).toBe(code);
  });
});

describe("the orca errors' own words", () => {
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
      "a renderer id that names none",
      new OrcaRendererUnknownError('Unknown renderer "vue"', "react"),
      {
        code: "E_VALIDATION",
        message: 'Unknown renderer "vue"',
        hint: "Available renderers: react.",
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
      "a SolidStart Vite config with no solidStart() plugin",
      new OrcaSolidStartPluginMissingError("Cannot wire middleware"),
      {
        code: "E_VALIDATION",
        hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.",
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
  ])("states %s with its own hint and facts", (_situation, error, stated) => {
    expect(error).toMatchObject(stated);
  });
});

describe("what each orca error states", () => {
  it.each([
    [
      "OrcaFrameworkMissingError",
      new classes.OrcaFrameworkMissingError("no framework"),
      {
        message: "no framework",
        hint: undefined,
        details: {},
        code: "E_FRAMEWORK_NOT_DETECTED",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaFrameworkUnsupportedError",
      new classes.OrcaFrameworkUnsupportedError("unsupported"),
      {
        message: "unsupported",
        hint: undefined,
        details: {},
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaInvalidError",
      new classes.OrcaInvalidError("invalid"),
      {
        message: "invalid",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaPatchFileMissingError",
      new classes.OrcaPatchFileMissingError("file missing"),
      {
        message: "file missing",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaRendererPendingError",
      new classes.OrcaRendererPendingError("renderer pending"),
      {
        message: "renderer pending",
        hint: undefined,
        details: {},
        code: "E_NOT_IMPLEMENTED",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaInternalError",
      new classes.OrcaInternalError("internal"),
      {
        message: "internal",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaConflictError",
      new classes.OrcaConflictError("conflict"),
      {
        message: "conflict",
        hint: undefined,
        details: {},
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaFrameworkMismatchError",
      new classes.OrcaFrameworkMismatchError("mismatch", "nuxt", "next", "Nuxt"),
      {
        message: "mismatch",
        hint: undefined,
        details: { requested: "nuxt", detected: "next" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaDirectoryNotEmptyError",
      new classes.OrcaDirectoryNotEmptyError("not empty", "has files", ["a.txt", "b.txt"]),
      {
        message: "not empty",
        hint: undefined,
        details: { entries: ["a.txt", "b.txt"] },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaVersionBelowFloorError",
      new classes.OrcaVersionBelowFloorError("too old", "Next.js", "14.0.0", "upgrade first"),
      {
        message: "too old",
        hint: "Upgrade the app to Next.js 14.0.0 or later and rerun. upgrade first",
        details: {},
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaPagesRouterError",
      new classes.OrcaPagesRouterError("pages router"),
      {
        message: "pages router",
        hint: "Create an App Router project with an app/ or src/app/ directory.",
        details: {},
        code: "E_UNSUPPORTED_PROJECT_SHAPE",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaNodeUnsupportedError",
      new classes.OrcaNodeUnsupportedError("node too old", "18.0.0", "20", ">=20", "Astro"),
      {
        message: "node too old",
        hint: undefined,
        details: { node: "18.0.0", required: "20" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaCommandSpawnFailedError",
      new classes.OrcaCommandSpawnFailedError("spawn failed", "npm", ["install"], "EACCES"),
      {
        message: "spawn failed",
        hint: undefined,
        details: { command: "npm", args: ["install"], code: "EACCES" },
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaCommandNotFoundError",
      new classes.OrcaCommandNotFoundError("not found", "pnpm", ["install"], "ENOENT"),
      {
        message: "not found",
        hint: "Ensure 'pnpm' is installed and on PATH.",
        details: { command: "pnpm", args: ["install"], code: "ENOENT" },
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaCommandFailedError",
      new classes.OrcaCommandFailedError("command failed", {
        command: "npm",
        args: ["install"],
        cwd: "/work",
        stdout: "out",
        stderr: "err",
        output: "out err",
      }),
      {
        message: "command failed",
        hint: "Command output:\nout err",
        details: { command: "npm", args: ["install"], cwd: "/work", stdout: "out", stderr: "err" },
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaFrameworkUnknownError",
      new classes.OrcaFrameworkUnknownError("unknown", "next, nuxt"),
      {
        message: "unknown",
        hint: "Supported frameworks: next, nuxt.",
        details: {},
        code: "E_FRAMEWORK_NOT_DETECTED",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaPatcherMissingError",
      new classes.OrcaPatcherMissingError("no patcher"),
      {
        message: "no patcher",
        hint: "Zitadel integration currently supports Next.js.",
        details: {},
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaPatchOpEmptyError",
      new classes.OrcaPatchOpEmptyError("empty op"),
      {
        message: "empty op",
        hint: "This is an internal patcher error — please report it if you hit it.",
        details: {},
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaAngularJsonMissingError",
      new classes.OrcaAngularJsonMissingError("no angular.json"),
      {
        message: "no angular.json",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaAngularProjectAmbiguousError",
      new classes.OrcaAngularProjectAmbiguousError("ambiguous", "a, b"),
      {
        message: "ambiguous",
        hint: 'Set "defaultProject" in angular.json, or add "proxyConfig" to the right project\'s serve target manually. Projects: a, b.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaAngularRoutesNotInlineError",
      new classes.OrcaAngularRoutesNotInlineError("routes not inline", "app.routes.ts"),
      {
        message: "routes not inline",
        hint: 'Set "routes" in app.routes.ts to an inline Routes array, or add /login, /register, and /profile manually.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaPackageJsonMissingError",
      new classes.OrcaPackageJsonMissingError("no package.json"),
      {
        message: "no package.json",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaZitadelConfigMissingError",
      new classes.OrcaZitadelConfigMissingError("no zitadel config"),
      {
        message: "no zitadel config",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaFileOverwriteError",
      new classes.OrcaFileOverwriteError("would overwrite", "src/auth.ts"),
      {
        message: "would overwrite",
        hint: undefined,
        details: { path: "src/auth.ts" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaBoundaryDuplicateError",
      new classes.OrcaBoundaryDuplicateError("duplicate", "src/a.ts", "src/b.ts"),
      {
        message: "duplicate",
        hint: undefined,
        details: { path: "src/a.ts", writes: "src/b.ts" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaBoundaryRenamedError",
      new classes.OrcaBoundaryRenamedError("renamed", "src/a.ts", "src/b.ts"),
      {
        message: "renamed",
        hint: undefined,
        details: { path: "src/a.ts", writes: "src/b.ts" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaBoundaryVersionUnknownError",
      new classes.OrcaBoundaryVersionUnknownError("version unknown", "src/a.ts", "src/b.ts"),
      {
        message: "version unknown",
        hint: undefined,
        details: { path: "src/a.ts", writes: "src/b.ts" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaRendererUnknownError",
      new classes.OrcaRendererUnknownError("unknown renderer", "react, vue"),
      {
        message: "unknown renderer",
        hint: "Available renderers: react, vue.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaProxyCredentialLeakError",
      new classes.OrcaProxyCredentialLeakError("leak", "/api/auth/exchange"),
      {
        message: "leak",
        hint: "Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange or /api/auth/exchange pathname and preserve caller-provided authorization.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaRootComponentMountError",
      new classes.OrcaRootComponentMountError("mount", {
        entry: "src/main.tsx",
        mountedRoot: "#root",
        root: "#app",
        statement: "render(<App />)",
      }),
      {
        message: "mount",
        hint: undefined,
        details: { path: "#root", entry: "src/main.tsx", writes: "#app" },
        code: "E_CONFLICT",
        category: "conflict",
        retryable: false,
      },
    ],
    [
      "OrcaSolidStartConfigMissingError",
      new classes.OrcaSolidStartConfigMissingError("no app.config.ts"),
      {
        message: "no app.config.ts",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaSolidStartPluginMissingError",
      new classes.OrcaSolidStartPluginMissingError("no plugin"),
      {
        message: "no plugin",
        hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaSvelteKitEnvVarsError",
      new classes.OrcaSvelteKitEnvVarsError(
        "env vars",
        "SvelteKit",
        "ZITADEL_ISSUER, ZITADEL_CLIENT_ID",
      ),
      {
        message: "env vars",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaConfigFileMissingError",
      new classes.OrcaConfigFileMissingError("no config", "vite.config.ts"),
      {
        message: "no config",
        hint: undefined,
        details: {},
        code: "E_VALIDATION",
        category: "missing",
        retryable: false,
      },
    ],
    [
      "OrcaConfigUnparseableError",
      new classes.OrcaConfigUnparseableError(
        "unparseable",
        "vite.config.ts",
        "Unexpected token",
        new Error("boom"),
      ),
      {
        message: "unparseable",
        hint: "Ensure vite.config.ts is valid, or apply the Zitadel changes manually.",
        details: { cause: "Unexpected token" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaConfigCommonJsError",
      new classes.OrcaConfigCommonJsError("commonjs", "vite.config.js"),
      {
        message: "commonjs",
        hint: 'The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaConfigObjectMissingError",
      new classes.OrcaConfigObjectMissingError("no object", "vite.config.ts"),
      {
        message: "no object",
        hint: "Add the Zitadel configuration to vite.config.ts manually (see the SDK README).",
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaConfigUnwritableError",
      new classes.OrcaConfigUnwritableError(
        "unwritable",
        "vite.config.ts",
        "Unexpected token",
        new Error("boom"),
      ),
      {
        message: "unwritable",
        hint: "The edit left vite.config.ts unparseable, so apply the Zitadel changes manually.",
        details: { cause: "Unexpected token" },
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaConfigObjectExpectedError",
      new classes.OrcaConfigObjectExpectedError("object expected", "plugins"),
      {
        message: "object expected",
        hint: 'Set "plugins" to an inline object literal, or add the Zitadel settings manually.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaConfigArrayExpectedError",
      new classes.OrcaConfigArrayExpectedError("array expected", "plugins"),
      {
        message: "array expected",
        hint: 'Set "plugins" to an inline array literal, or add the Zitadel settings manually.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaScaffolderMissingError",
      new classes.OrcaScaffolderMissingError("no scaffolder", "next, nuxt"),
      {
        message: "no scaffolder",
        hint: "Available frameworks: next, nuxt.",
        details: {},
        code: "E_VALIDATION",
        category: "fault",
        retryable: false,
      },
    ],
    [
      "OrcaAngularProjectMissingError",
      new classes.OrcaAngularProjectMissingError("no project"),
      {
        message: "no project",
        hint: 'Add "proxyConfig" to your serve target manually.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaAngularServeTargetMissingError",
      new classes.OrcaAngularServeTargetMissingError("no serve target"),
      {
        message: "no serve target",
        hint: 'Add "proxyConfig" to your serve options manually.',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
    [
      "OrcaSolidStartOptionsError",
      new classes.OrcaSolidStartOptionsError("bad options"),
      {
        message: "bad options",
        hint: 'Pass an options object to solidStart(), e.g. solidStart({ middleware: "./src/middleware.ts" }).',
        details: {},
        code: "E_VALIDATION",
        category: "invalid",
        retryable: false,
      },
    ],
  ])("states what a %s says and reports", (_name, error, expected) => {
    expect({
      message: error.message,
      hint: error.hint,
      details: error.details,
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    }).toEqual(expected);
  });
});
