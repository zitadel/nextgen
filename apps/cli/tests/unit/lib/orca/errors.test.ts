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
