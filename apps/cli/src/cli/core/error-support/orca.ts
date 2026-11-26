import {
  OrcaAngularJsonMissingError,
  OrcaAngularProjectAmbiguousError,
  OrcaAngularProjectMissingError,
  OrcaAngularRoutesNotInlineError,
  OrcaAngularServeTargetMissingError,
  OrcaBoundaryDuplicateError,
  OrcaBoundaryRenamedError,
  OrcaBoundaryVersionUnknownError,
  OrcaCommandFailedError,
  OrcaCommandNotFoundError,
  OrcaCommandSpawnFailedError,
  OrcaConfigArrayExpectedError,
  OrcaConfigCommonJsError,
  OrcaConfigFileMissingError,
  OrcaConfigObjectExpectedError,
  OrcaConfigObjectMissingError,
  OrcaConfigUnparseableError,
  OrcaConfigUnwritableError,
  OrcaConflictError,
  OrcaDirectoryNotEmptyError,
  OrcaFileOverwriteError,
  OrcaFrameworkMismatchError,
  OrcaFrameworkMissingError,
  OrcaFrameworkUnknownError,
  OrcaFrameworkUnsupportedError,
  OrcaInternalError,
  OrcaInvalidError,
  OrcaNodeUnsupportedError,
  OrcaPackageJsonMissingError,
  OrcaPagesRouterError,
  OrcaPatchFileMissingError,
  OrcaPatchOpEmptyError,
  OrcaPatcherMissingError,
  OrcaProxyCredentialLeakError,
  OrcaRendererPendingError,
  OrcaRendererUnknownError,
  OrcaRootComponentMountError,
  OrcaScaffolderMissingError,
  OrcaSolidStartConfigMissingError,
  OrcaSolidStartOptionsError,
  OrcaSolidStartPluginMissingError,
  OrcaSvelteKitEnvVarsError,
  OrcaVersionBelowFloorError,
  OrcaZitadelConfigMissingError,
} from "@/lib/orca";

import type { Refusal } from "@/cli/core/refusal";
import { derived, type Wording } from "./wording";

/** How {@link OrcaCommandNotFoundError} is refused. */
const COMMAND_NOT_FOUND_REFUSAL = {
  message: "{message}",
  hint: "Ensure '{command}' is installed and on PATH.",
  details: {
    command: "{command}",
    args: "{args}",
    code: "{spawnCode}",
  },
} as const satisfies Refusal;

/** How {@link OrcaBoundaryDuplicateError} is refused. */
const BOUNDARY_DUPLICATE_REFUSAL = {
  message: "{message}",
  hint: "Setup writes {target}, and one of the two would never run. Move {existing} aside and rerun setup, then merge it into {target}. --force can't fix this: it only replaces files at the paths setup writes.",
  details: {
    path: "{existing}",
    writes: "{target}",
  },
} as const satisfies Refusal;

/** How {@link OrcaBoundaryRenamedError} is refused. */
const BOUNDARY_RENAMED_REFUSAL = {
  message: "{message}",
  hint: "Next.js 16 renamed middleware.ts to proxy.ts. Move {existing} aside and rerun setup, then merge it into {target}. --force can't fix this: it only replaces files at the paths setup writes.",
  details: {
    path: "{existing}",
    writes: "{target}",
  },
} as const satisfies Refusal;

/** How {@link OrcaBoundaryVersionUnknownError} is refused. */
const BOUNDARY_VERSION_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: 'Setup reads no Next.js version from package.json (a tag such as "latest" names none), so it writes the {target} of Next 15. Pin next to the version range the app runs, such as "^16.0.0", and rerun setup: on Next 16 it then writes proxy.ts, and on Next 15 it leaves your {existing} alone. --force can\'t fix this: it only replaces files at the paths setup writes.',
  details: {
    path: "{existing}",
    writes: "{target}",
  },
} as const satisfies Refusal;

/** How {@link OrcaConfigUnparseableError} is refused. */
const CONFIG_UNPARSEABLE_REFUSAL = {
  message: "{message}",
  hint: "Ensure {filename} is valid, or apply the Zitadel changes manually.",
  details: {
    cause: "{parseError}",
  },
} as const satisfies Refusal;

/** How {@link OrcaConfigCommonJsError} is refused. */
const CONFIG_COMMON_JS_REFUSAL = {
  message: "{message}",
  hint: 'The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.',
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaConfigObjectMissingError} is refused. */
const CONFIG_OBJECT_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Add the Zitadel configuration to {filename} manually (see the SDK README).",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaConfigUnwritableError} is refused. */
const CONFIG_UNWRITABLE_REFUSAL = {
  message: "{message}",
  hint: "The edit left {filename} unparseable, so apply the Zitadel changes manually.",
  details: {
    cause: "{parseError}",
  },
} as const satisfies Refusal;

/** How {@link OrcaConfigObjectExpectedError} is refused. */
const CONFIG_OBJECT_EXPECTED_REFUSAL = {
  message: "{message}",
  hint: 'Set "{key}" to an inline object literal, or add the Zitadel settings manually.',
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaConfigArrayExpectedError} is refused. */
const CONFIG_ARRAY_EXPECTED_REFUSAL = {
  message: "{message}",
  hint: 'Set "{key}" to an inline array literal, or add the Zitadel settings manually.',
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaFrameworkMismatchError} is refused. */
const FRAMEWORK_MISMATCH_REFUSAL = {
  message: "{message}",
  hint: "Rerun setup without --framework, or with --framework {detected}, to set up this app, or point --cwd at the {requestedName} app you meant. Setup never scaffolds a new app over one it detects, --force or not.",
  details: {
    requested: "{requested}",
    detected: "{detected}",
  },
} as const satisfies Refusal;

/** How {@link OrcaDirectoryNotEmptyError} is refused. */
const DIRECTORY_NOT_EMPTY_REFUSAL = {
  message: "{message}",
  hint: "{reason}Pass --force to scaffold into a non-empty directory, or run setup from an existing supported app project.",
  details: {
    entries: "{entries}",
  },
} as const satisfies Refusal;

/** How {@link OrcaVersionBelowFloorError} is refused. */
const VERSION_BELOW_FLOOR_REFUSAL = {
  message: "{message}",
  hint: "Upgrade the app to {displayName} {versionFloor} or later and rerun.{note}",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaPagesRouterError} is refused. */
const PAGES_ROUTER_REFUSAL = {
  message: "{message}",
  hint: "Create an App Router project with an app/ or src/app/ directory.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaNodeUnsupportedError} is refused. */
const NODE_UNSUPPORTED_REFUSAL = {
  message: "{message}",
  hint: "Switch to Node {accepted} and rerun, or create the {displayName} app with that Node and run setup inside it.",
  details: {
    node: "{node}",
    required: "{required}",
  },
} as const satisfies Refusal;

/** How {@link OrcaCommandSpawnFailedError} is refused. */
const COMMAND_SPAWN_FAILED_REFUSAL = {
  message: "{message}",
  details: {
    command: "{command}",
    args: "{args}",
    code: "{spawnCode}",
  },
} as const satisfies Refusal;

/** How {@link OrcaCommandFailedError} is refused. */
const COMMAND_FAILED_REFUSAL = {
  message: "{message}",
  hint: "{remedy}",
  details: {
    command: "{command}",
    args: "{args}",
    cwd: "{cwd}",
    stdout: "{stdout}",
    stderr: "{stderr}",
  },
} as const satisfies Refusal;

/** How {@link OrcaFrameworkUnknownError} is refused. */
const FRAMEWORK_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "Supported frameworks: {supported}.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaPatcherMissingError} is refused. */
const PATCHER_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Zitadel integration currently supports Next.js.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaPatchOpEmptyError} is refused. */
const PATCH_OP_EMPTY_REFUSAL = {
  message: "{message}",
  hint: "This is an internal patcher error — please report it if you hit it.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaAngularJsonMissingError} is refused. */
const ANGULAR_JSON_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run setup from an Angular project.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaAngularProjectAmbiguousError} is refused. */
const ANGULAR_PROJECT_AMBIGUOUS_REFUSAL = {
  message: "{message}",
  hint: `Set "defaultProject" in angular.json, or add "proxyConfig" to the right project's serve target manually. Projects: {projects}.`,
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaAngularRoutesNotInlineError} is refused. */
const ANGULAR_ROUTES_NOT_INLINE_REFUSAL = {
  message: "{message}",
  hint: 'Set "routes" in {label} to an inline Routes array, or add /login, /register, and /profile manually.',
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaPackageJsonMissingError} is refused. */
const PACKAGE_JSON_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run setup from a project that has a package.json.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaZitadelConfigMissingError} is refused. */
const ZITADEL_CONFIG_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run `zitadel setup` first.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaFileOverwriteError} is refused. */
const FILE_OVERWRITE_REFUSAL = {
  message: "{message}",
  hint: "Rerun with --force if you want the CLI to replace this file.",
  details: {
    path: "{path}",
  },
} as const satisfies Refusal;

/** How {@link OrcaRendererUnknownError} is refused. */
const RENDERER_UNKNOWN_REFUSAL = {
  message: "{message}",
  hint: "Available renderers: {renderers}.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaProxyCredentialLeakError} is refused. */
const PROXY_CREDENTIAL_LEAK_REFUSAL = {
  message: "{message}",
  hint: "Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange or {exchangePath} pathname and preserve caller-provided authorization.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaRootComponentMountError} is refused. */
const ROOT_COMPONENT_MOUNT_REFUSAL = {
  message: "{message}",
  hint: "Your app would keep loading {mountedRoot}, and the root component setup writes would never run. In {entry}, import the root as `{statement}` and mount that instead, then rerun setup and move what you need from {mountedRoot} into {root}. --force can't fix this: it only replaces files at the paths setup writes.",
  details: {
    path: "{mountedRoot}",
    entry: "{entry}",
    writes: "{root}",
  },
} as const satisfies Refusal;

/** How {@link OrcaSolidStartConfigMissingError} is refused. */
const SOLID_START_CONFIG_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run setup from a SolidStart project that has a vite.config.ts.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaSolidStartPluginMissingError} is refused. */
const SOLID_START_PLUGIN_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaSvelteKitEnvVarsError} is refused. */
const SVELTE_KIT_ENV_VARS_REFUSAL = {
  message: "{message}",
  hint: "Export them as `export const variables = defineEnvVars({ ... })` from @sveltejs/kit/env, or declare {variables} there by hand.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaConfigFileMissingError} is refused. */
const CONFIG_FILE_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run setup from a project that has {filename}.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaFrameworkMissingError} is refused. */
const FRAMEWORK_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaFrameworkUnsupportedError} is refused. */
const FRAMEWORK_UNSUPPORTED_REFUSAL = {
  message: "{message}",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaInvalidError} is refused. */
const INVALID_REFUSAL = {
  message: "{message}",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaPatchFileMissingError} is refused. */
const PATCH_FILE_MISSING_REFUSAL = {
  message: "{message}",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaRendererPendingError} is refused. */
const RENDERER_PENDING_REFUSAL = {
  message: "{message}",
  hint: "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaInternalError} is refused. */
const INTERNAL_REFUSAL = {
  message: "{message}",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaConflictError} is refused. */
const CONFLICT_REFUSAL = {
  message: "{message}",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaScaffolderMissingError} is refused. */
const SCAFFOLDER_MISSING_REFUSAL = {
  message: "{message}",
  hint: "Available frameworks: {frameworks}.",
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaAngularProjectMissingError} is refused. */
const ANGULAR_PROJECT_MISSING_REFUSAL = {
  message: "{message}",
  hint: 'Add "proxyConfig" to your serve target manually.',
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaAngularServeTargetMissingError} is refused. */
const ANGULAR_SERVE_TARGET_MISSING_REFUSAL = {
  message: "{message}",
  hint: 'Add "proxyConfig" to your serve options manually.',
  details: {},
} as const satisfies Refusal;

/** How {@link OrcaSolidStartOptionsError} is refused. */
const SOLID_START_OPTIONS_REFUSAL = {
  message: "{message}",
  hint: 'Pass an options object to solidStart(), e.g. solidStart({ middleware: "./src/middleware.ts" }).',
  details: {},
} as const satisfies Refusal;

/** How the errors of `@/lib/orca` are worded, most specific class first. */
export const ORCA_WORDINGS: readonly Wording[] = [
  [OrcaCommandNotFoundError, COMMAND_NOT_FOUND_REFUSAL],
  [OrcaBoundaryDuplicateError, BOUNDARY_DUPLICATE_REFUSAL],
  [OrcaBoundaryRenamedError, BOUNDARY_RENAMED_REFUSAL],
  [OrcaBoundaryVersionUnknownError, BOUNDARY_VERSION_UNKNOWN_REFUSAL],
  [OrcaConfigUnparseableError, CONFIG_UNPARSEABLE_REFUSAL],
  [OrcaConfigCommonJsError, CONFIG_COMMON_JS_REFUSAL],
  [OrcaConfigObjectMissingError, CONFIG_OBJECT_MISSING_REFUSAL],
  [OrcaConfigUnwritableError, CONFIG_UNWRITABLE_REFUSAL],
  [OrcaConfigObjectExpectedError, CONFIG_OBJECT_EXPECTED_REFUSAL],
  [OrcaConfigArrayExpectedError, CONFIG_ARRAY_EXPECTED_REFUSAL],
  [OrcaFrameworkMismatchError, FRAMEWORK_MISMATCH_REFUSAL],
  derived(OrcaDirectoryNotEmptyError, DIRECTORY_NOT_EMPTY_REFUSAL, (error) => {
    return {
      values: {
        reason: error.reason === undefined ? "" : `${error.reason} `,
      },
    };
  }),
  derived(OrcaVersionBelowFloorError, VERSION_BELOW_FLOOR_REFUSAL, (error) => {
    return {
      values: {
        note: error.note === undefined ? "" : ` ${error.note}`,
      },
    };
  }),
  [OrcaPagesRouterError, PAGES_ROUTER_REFUSAL],
  [OrcaNodeUnsupportedError, NODE_UNSUPPORTED_REFUSAL],
  [OrcaCommandSpawnFailedError, COMMAND_SPAWN_FAILED_REFUSAL],
  derived(OrcaCommandFailedError, COMMAND_FAILED_REFUSAL, (error) => {
    return {
      values: {
        remedy:
          error.output === ""
            ? "Run the command directly for more detail."
            : `Command output:\n${error.output}`,
      },
    };
  }),
  [OrcaFrameworkUnknownError, FRAMEWORK_UNKNOWN_REFUSAL],
  [OrcaPatcherMissingError, PATCHER_MISSING_REFUSAL],
  [OrcaScaffolderMissingError, SCAFFOLDER_MISSING_REFUSAL],
  [OrcaAngularProjectMissingError, ANGULAR_PROJECT_MISSING_REFUSAL],
  [OrcaAngularServeTargetMissingError, ANGULAR_SERVE_TARGET_MISSING_REFUSAL],
  [OrcaSolidStartOptionsError, SOLID_START_OPTIONS_REFUSAL],
  [OrcaPatchOpEmptyError, PATCH_OP_EMPTY_REFUSAL],
  [OrcaAngularJsonMissingError, ANGULAR_JSON_MISSING_REFUSAL],
  [OrcaAngularProjectAmbiguousError, ANGULAR_PROJECT_AMBIGUOUS_REFUSAL],
  [OrcaAngularRoutesNotInlineError, ANGULAR_ROUTES_NOT_INLINE_REFUSAL],
  [OrcaPackageJsonMissingError, PACKAGE_JSON_MISSING_REFUSAL],
  [OrcaZitadelConfigMissingError, ZITADEL_CONFIG_MISSING_REFUSAL],
  [OrcaFileOverwriteError, FILE_OVERWRITE_REFUSAL],
  [OrcaRendererUnknownError, RENDERER_UNKNOWN_REFUSAL],
  [OrcaProxyCredentialLeakError, PROXY_CREDENTIAL_LEAK_REFUSAL],
  [OrcaRootComponentMountError, ROOT_COMPONENT_MOUNT_REFUSAL],
  [OrcaSolidStartConfigMissingError, SOLID_START_CONFIG_MISSING_REFUSAL],
  [OrcaSolidStartPluginMissingError, SOLID_START_PLUGIN_MISSING_REFUSAL],
  [OrcaSvelteKitEnvVarsError, SVELTE_KIT_ENV_VARS_REFUSAL],
  [OrcaConfigFileMissingError, CONFIG_FILE_MISSING_REFUSAL],
  [OrcaFrameworkMissingError, FRAMEWORK_MISSING_REFUSAL],
  [OrcaFrameworkUnsupportedError, FRAMEWORK_UNSUPPORTED_REFUSAL],
  [OrcaInvalidError, INVALID_REFUSAL],
  [OrcaPatchFileMissingError, PATCH_FILE_MISSING_REFUSAL],
  [OrcaRendererPendingError, RENDERER_PENDING_REFUSAL],
  [OrcaInternalError, INTERNAL_REFUSAL],
  [OrcaConflictError, CONFLICT_REFUSAL],
];
