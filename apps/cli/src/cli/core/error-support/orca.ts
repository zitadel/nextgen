import {
  OrcaAngularJsonMissingError,
  OrcaBoundaryDuplicateError,
  OrcaBoundaryRenamedError,
  OrcaBoundaryVersionUnknownError,
  OrcaConfigFileMissingError,
  OrcaDirectoryNotEmptyError,
  OrcaFileOverwriteError,
  OrcaFrameworkMismatchError,
  OrcaFrameworkMissingError,
  OrcaNodeUnsupportedError,
  OrcaPackageJsonMissingError,
  OrcaRendererPendingError,
  OrcaRootComponentMountError,
  OrcaSolidStartConfigMissingError,
  OrcaSvelteKitEnvVarsError,
  OrcaZitadelConfigMissingError,
} from "@/lib/orca";

import { type Advice, derived, type Wording } from "./wording";

/** How {@link OrcaBoundaryDuplicateError} is refused. */
const BOUNDARY_DUPLICATE_ADVICE = {
  hint: "Setup writes {target}, and one of the two would never run. Move {existing} aside and rerun setup, then merge it into {target}. --force can't fix this: it only replaces files at the paths setup writes.",
} as const satisfies Advice;

/** How {@link OrcaBoundaryRenamedError} is refused. */
const BOUNDARY_RENAMED_ADVICE = {
  hint: "Next.js 16 renamed middleware.ts to proxy.ts. Move {existing} aside and rerun setup, then merge it into {target}. --force can't fix this: it only replaces files at the paths setup writes.",
} as const satisfies Advice;

/** How {@link OrcaBoundaryVersionUnknownError} is refused. */
const BOUNDARY_VERSION_UNKNOWN_ADVICE = {
  hint: 'Setup reads no Next.js version from package.json (a tag such as "latest" names none), so it writes the {target} of Next 15. Pin next to the version range the app runs, such as "^16.0.0", and rerun setup: on Next 16 it then writes proxy.ts, and on Next 15 it leaves your {existing} alone. --force can\'t fix this: it only replaces files at the paths setup writes.',
} as const satisfies Advice;

/** How {@link OrcaFrameworkMismatchError} is refused. */
const FRAMEWORK_MISMATCH_ADVICE = {
  hint: "Rerun setup without --framework, or with --framework {detected}, to set up this app, or point --cwd at the {requestedName} app you meant. Setup never scaffolds a new app over one it detects, --force or not.",
} as const satisfies Advice;

/** How {@link OrcaDirectoryNotEmptyError} is refused. */
const DIRECTORY_NOT_EMPTY_ADVICE = {
  hint: "{reason}Pass --force to scaffold into a non-empty directory, or run setup from an existing supported app project.",
} as const satisfies Advice;

/** How {@link OrcaNodeUnsupportedError} is refused. */
const NODE_UNSUPPORTED_ADVICE = {
  hint: "Switch to Node {accepted} and rerun, or create the {displayName} app with that Node and run setup inside it.",
} as const satisfies Advice;

/** How {@link OrcaAngularJsonMissingError} is refused. */
const ANGULAR_JSON_MISSING_ADVICE = {
  hint: "Run setup from an Angular project.",
} as const satisfies Advice;

/** How {@link OrcaPackageJsonMissingError} is refused. */
const PACKAGE_JSON_MISSING_ADVICE = {
  hint: "Run setup from a project that has a package.json.",
} as const satisfies Advice;

/** How {@link OrcaZitadelConfigMissingError} is refused. */
const ZITADEL_CONFIG_MISSING_ADVICE = {
  hint: "Run `zitadel setup` first.",
} as const satisfies Advice;

/** How {@link OrcaFileOverwriteError} is refused. */
const FILE_OVERWRITE_ADVICE = {
  hint: "Rerun with --force if you want the CLI to replace this file.",
} as const satisfies Advice;

/** How {@link OrcaRootComponentMountError} is refused. */
const ROOT_COMPONENT_MOUNT_ADVICE = {
  hint: "Your app would keep loading {mountedRoot}, and the root component setup writes would never run. In {entry}, import the root as `{statement}` and mount that instead, then rerun setup and move what you need from {mountedRoot} into {root}. --force can't fix this: it only replaces files at the paths setup writes.",
} as const satisfies Advice;

/** How {@link OrcaSolidStartConfigMissingError} is refused. */
const SOLID_START_CONFIG_MISSING_ADVICE = {
  hint: "Run setup from a SolidStart project that has a vite.config.ts.",
} as const satisfies Advice;

/** How {@link OrcaSvelteKitEnvVarsError} is refused. */
const SVELTE_KIT_ENV_VARS_ADVICE = {
  hint: "Export them as `export const variables = defineEnvVars({ ... })` from @sveltejs/kit/env, or declare {variables} there by hand.",
} as const satisfies Advice;

/** How {@link OrcaConfigFileMissingError} is refused. */
const CONFIG_FILE_MISSING_ADVICE = {
  hint: "Run setup from a project that has {filename}.",
} as const satisfies Advice;

/** How {@link OrcaFrameworkMissingError} is refused. */
const FRAMEWORK_MISSING_ADVICE = {
  hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
} as const satisfies Advice;

/** How {@link OrcaRendererPendingError} is refused. */
const RENDERER_PENDING_ADVICE = {
  hint: "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
} as const satisfies Advice;

/** How the errors of `@/lib/orca` are advised on, each for exactly its class. */
export const ORCA_WORDINGS: readonly Wording[] = [
  [OrcaBoundaryDuplicateError, BOUNDARY_DUPLICATE_ADVICE],
  [OrcaBoundaryRenamedError, BOUNDARY_RENAMED_ADVICE],
  [OrcaBoundaryVersionUnknownError, BOUNDARY_VERSION_UNKNOWN_ADVICE],
  [OrcaFrameworkMismatchError, FRAMEWORK_MISMATCH_ADVICE],
  derived(OrcaDirectoryNotEmptyError, DIRECTORY_NOT_EMPTY_ADVICE, (error) => {
    return {
      values: {
        reason: error.reason === undefined ? "" : `${error.reason} `,
      },
    };
  }),
  [OrcaNodeUnsupportedError, NODE_UNSUPPORTED_ADVICE],
  [OrcaAngularJsonMissingError, ANGULAR_JSON_MISSING_ADVICE],
  [OrcaPackageJsonMissingError, PACKAGE_JSON_MISSING_ADVICE],
  [OrcaZitadelConfigMissingError, ZITADEL_CONFIG_MISSING_ADVICE],
  [OrcaFileOverwriteError, FILE_OVERWRITE_ADVICE],
  [OrcaRootComponentMountError, ROOT_COMPONENT_MOUNT_ADVICE],
  [OrcaSolidStartConfigMissingError, SOLID_START_CONFIG_MISSING_ADVICE],
  [OrcaSvelteKitEnvVarsError, SVELTE_KIT_ENV_VARS_ADVICE],
  [OrcaConfigFileMissingError, CONFIG_FILE_MISSING_ADVICE],
  [OrcaFrameworkMissingError, FRAMEWORK_MISSING_ADVICE],
  [OrcaRendererPendingError, RENDERER_PENDING_ADVICE],
];
