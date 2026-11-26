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

import { CWD, type Row } from "./row";

/** The note the Next.js detector gives for its version floor. */
const NEXT_FLOOR_NOTE = "Earlier releases let a request skip middleware (CVE-2025-29927).";

/** What main appended to every hint of a preflight refusal. */
const FORCE_NOTE = "--force can't fix this: it only replaces files at the paths setup writes.";

/** The frameworks the sample orca knows, joined with commas. */
const FRAMEWORKS = "next, react";

/** The config module every config row edits. */
const CONFIG = "nuxt.config.ts";

/** What the parser said about the sample config module. */
const PARSE_ERROR = "Unexpected token (3:5)";

/** The arguments every scaffold command row ran with. */
const ARGS = ["create-next-app@latest", "."] as const;

/** What the sample scaffold command wrote to stderr. */
const STDERR = "npm ERR! code E404";

/** The entries of the sample non-empty directory. */
const ENTRIES = ["README.md", "notes.txt"] as const;

/** The SvelteKit env module, as the patch names it. */
const ENV_LABEL = "src/env.ts";

/** The variables the SvelteKit hooks need, joined with commas. */
const HOOK_VARIABLES = "ZITADEL_URL, ZITADEL_PROJECT_SECRET, ZITADEL_PROJECT_ID";

/** The exchange path with the auth prefix. */
const EXCHANGE_PATH = "/__nextgen/sessions/exchange";

/** The Node range the sample scaffolding tool declares. */
const NODE_RANGE = "^20.19.0 || >=22.12.0";

/** The errors of `@/lib/orca`, each with what main showed for it. */
export const ORCA_ROWS: readonly Row[] = [
  {
    error: new OrcaFrameworkMissingError("Could not detect a supported app framework"),
    main: "lib/orca/index.ts:178",
    expected: {
      code: "E_FRAMEWORK_NOT_DETECTED",
      message: "Could not detect a supported app framework",
      hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaFrameworkUnknownError('Unsupported framework "ember"', FRAMEWORKS),
    main: "lib/orca/index.ts:154",
    expected: {
      code: "E_FRAMEWORK_NOT_DETECTED",
      message: 'Unsupported framework "ember"',
      hint: `Supported frameworks: ${FRAMEWORKS}.`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaFrameworkMismatchError(
      "Setup detects Next.js here, not React",
      "react",
      "next",
      "React",
    ),
    main: "lib/orca/index.ts:364",
    expected: {
      code: "E_CONFLICT",
      message: "Setup detects Next.js here, not React",
      hint: "Rerun setup without --framework, or with --framework next, to set up this app, or point --cwd at the React app you meant. Setup never scaffolds a new app over one it detects, --force or not.",
      details: { requested: "react", detected: "next" },
      exitCode: 5,
    },
  },
  {
    case: "a directory that only holds files",
    error: new OrcaDirectoryNotEmptyError(`Cannot scaffold: ${CWD} is not empty`, undefined, [
      ...ENTRIES,
    ]),
    main: "lib/orca/index.ts:255",
    expected: {
      code: "E_CONFLICT",
      message: `Cannot scaffold: ${CWD} is not empty`,
      hint: "Pass --force to scaffold into a non-empty directory, or run setup from an existing supported app project.",
      details: { entries: [...ENTRIES] },
      exitCode: 5,
    },
  },
  {
    case: "a directory with a reason it is unfit",
    error: new OrcaDirectoryNotEmptyError(
      `Cannot scaffold: ${CWD} is not empty`,
      "It holds a git repository.",
      [...ENTRIES],
    ),
    main: "lib/orca/index.ts:255",
    expected: {
      code: "E_CONFLICT",
      message: `Cannot scaffold: ${CWD} is not empty`,
      hint: "It holds a git repository. Pass --force to scaffold into a non-empty directory, or run setup from an existing supported app project.",
      details: { entries: [...ENTRIES] },
      exitCode: 5,
    },
  },
  {
    error: new OrcaScaffolderMissingError('No scaffolder supports "ember"', FRAMEWORKS),
    main: "lib/orca/index.ts:307",
    expected: {
      code: "E_VALIDATION",
      message: 'No scaffolder supports "ember"',
      hint: `Available frameworks: ${FRAMEWORKS}.`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaInternalError("A patcher planned two writes to app/layout.tsx"),
    main: "lib/orca/index.ts:307",
    expected: {
      code: "E_VALIDATION",
      message: "A patcher planned two writes to app/layout.tsx",
      exitCode: 3,
    },
  },
  {
    error: new OrcaPatcherMissingError('No patcher supports "ember"'),
    main: "lib/orca/index.ts:327",
    expected: {
      code: "E_VALIDATION",
      message: 'No patcher supports "ember"',
      hint: "Zitadel integration currently supports Next.js.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaFrameworkUnsupportedError("Next.js app in a shape the CLI does not integrate"),
    main: "lib/orca/detectors/next.ts:47",
    expected: {
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
      message: "Next.js app in a shape the CLI does not integrate",
      exitCode: 3,
    },
  },
  {
    error: new OrcaPagesRouterError("Next.js Pages Router projects are not supported in v1"),
    main: "lib/orca/detectors/next.ts:47",
    expected: {
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
      message: "Next.js Pages Router projects are not supported in v1",
      hint: "Create an App Router project with an app/ or src/app/ directory.",
      exitCode: 3,
    },
  },
  {
    case: "a declared version below the floor, with a note",
    error: new OrcaVersionBelowFloorError(
      'Next.js "^14.2.0" is below the supported floor — the CLI integrates Next.js 15.2.3 and newer',
      "Next.js",
      "15.2.3",
      NEXT_FLOOR_NOTE,
    ),
    main: "lib/orca/detectors/version-floor.ts:36",
    expected: {
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
      message:
        'Next.js "^14.2.0" is below the supported floor — the CLI integrates Next.js 15.2.3 and newer',
      hint: `Upgrade the app to Next.js 15.2.3 or later and rerun. ${NEXT_FLOOR_NOTE}`,
      exitCode: 3,
    },
  },
  {
    case: "an installed version below the floor, without a note",
    error: new OrcaVersionBelowFloorError(
      "Nuxt 3.9.0 is installed (node_modules/nuxt/package.json), below the supported floor — the CLI integrates Nuxt 3.12.0 and newer",
      "Nuxt",
      "3.12.0",
      undefined,
    ),
    main: "lib/orca/detectors/version-floor.ts:45",
    expected: {
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
      message:
        "Nuxt 3.9.0 is installed (node_modules/nuxt/package.json), below the supported floor — the CLI integrates Nuxt 3.12.0 and newer",
      hint: "Upgrade the app to Nuxt 3.12.0 or later and rerun.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaNodeUnsupportedError(
      `create-next-app needs Node ${NODE_RANGE}; this is Node v21.7.0`,
      "21.7.0",
      NODE_RANGE,
      "20.19.0 or newer 20, or 22.12.0 or newer 22",
      "Next.js",
    ),
    main: "lib/orca/scaffolders/cli.ts:122",
    expected: {
      code: "E_VALIDATION",
      message: `create-next-app needs Node ${NODE_RANGE}; this is Node v21.7.0`,
      hint: "Switch to Node 20.19.0 or newer 20, or 22.12.0 or newer 22 and rerun, or create the Next.js app with that Node and run setup inside it.",
      details: { node: "21.7.0", required: NODE_RANGE },
      exitCode: 3,
    },
  },
  {
    error: new OrcaCommandNotFoundError("Command not found: npx", "npx", [...ARGS], "ENOENT"),
    main: "lib/orca/scaffolders/cli.ts:145",
    expected: {
      code: "E_VALIDATION",
      message: "Command not found: npx",
      hint: "Ensure 'npx' is installed and on PATH.",
      details: { command: "npx", args: [...ARGS], code: "ENOENT" },
      exitCode: 3,
    },
  },
  {
    error: new OrcaCommandSpawnFailedError(
      'Failed to spawn "npx": spawn npx EACCES',
      "npx",
      [...ARGS],
      "EACCES",
    ),
    main: "lib/orca/scaffolders/cli.ts:145",
    expected: {
      code: "E_VALIDATION",
      message: 'Failed to spawn "npx": spawn npx EACCES',
      details: { command: "npx", args: [...ARGS], code: "EACCES" },
      exitCode: 3,
    },
  },
  {
    case: "a command that wrote output",
    error: new OrcaCommandFailedError(
      'Command "npx create-next-app@latest ." exited with status 1',
      {
        command: "npx",
        args: [...ARGS],
        cwd: CWD,
        stdout: "",
        stderr: STDERR,
        output: STDERR,
      },
    ),
    main: "lib/orca/scaffolders/cli.ts:161",
    expected: {
      code: "E_VALIDATION",
      message: 'Command "npx create-next-app@latest ." exited with status 1',
      hint: `Command output:\n${STDERR}`,
      details: { command: "npx", args: [...ARGS], cwd: CWD, stdout: "", stderr: STDERR },
      exitCode: 3,
    },
  },
  {
    case: "a command that wrote nothing",
    error: new OrcaCommandFailedError(
      'Command "npx create-next-app@latest ." exited with status 1',
      {
        command: "npx",
        args: [...ARGS],
        cwd: CWD,
        stdout: "",
        stderr: "",
        output: "",
      },
    ),
    main: "lib/orca/scaffolders/cli.ts:161",
    expected: {
      code: "E_VALIDATION",
      message: 'Command "npx create-next-app@latest ." exited with status 1',
      hint: "Run the command directly for more detail.",
      details: { command: "npx", args: [...ARGS], cwd: CWD, stdout: "", stderr: "" },
      exitCode: 3,
    },
  },
  {
    error: new OrcaRootComponentMountError(
      "src/main.tsx mounts src/App.tsx, not the src/Root.tsx setup writes",
      {
        entry: "src/main.tsx",
        mountedRoot: "src/App.tsx",
        root: "src/Root.tsx",
        statement: 'import Root from "./Root"',
      },
    ),
    main: "lib/orca/patchers/rule/root-component.ts:106",
    expected: {
      code: "E_CONFLICT",
      message: "src/main.tsx mounts src/App.tsx, not the src/Root.tsx setup writes",
      hint: `Your app would keep loading src/App.tsx, and the root component setup writes would never run. In src/main.tsx, import the root as \`import Root from "./Root"\` and mount that instead, then rerun setup and move what you need from src/App.tsx into src/Root.tsx. ${FORCE_NOTE}`,
      details: { path: "src/App.tsx", entry: "src/main.tsx", writes: "src/Root.tsx" },
      exitCode: 5,
    },
  },
  {
    error: new OrcaConflictError("The app already holds what setup writes"),
    main: "lib/orca/patchers/rule/file-writer/ops/write.ts:32",
    expected: {
      code: "E_CONFLICT",
      message: "The app already holds what setup writes",
      exitCode: 5,
    },
  },
  {
    error: new OrcaFileOverwriteError(
      "Refusing to overwrite app/login/page.tsx",
      "app/login/page.tsx",
    ),
    main: "lib/orca/patchers/rule/file-writer/ops/write.ts:32",
    expected: {
      code: "E_CONFLICT",
      message: "Refusing to overwrite app/login/page.tsx",
      hint: "Rerun with --force if you want the CLI to replace this file.",
      details: { path: "app/login/page.tsx" },
      exitCode: 5,
    },
  },
  {
    error: new OrcaBoundaryDuplicateError(
      "Next.js runs one middleware file, and this app already has src/middleware.ts",
      "src/middleware.ts",
      "middleware.ts",
    ),
    main: "lib/orca/patchers/rule/next/index.ts:345",
    expected: {
      code: "E_CONFLICT",
      message: "Next.js runs one middleware file, and this app already has src/middleware.ts",
      hint: `Setup writes middleware.ts, and one of the two would never run. Move src/middleware.ts aside and rerun setup, then merge it into middleware.ts. ${FORCE_NOTE}`,
      details: { path: "src/middleware.ts", writes: "middleware.ts" },
      exitCode: 5,
    },
  },
  {
    error: new OrcaBoundaryRenamedError(
      "Next.js 16 will not start with both middleware.ts and the proxy.ts setup writes",
      "middleware.ts",
      "proxy.ts",
    ),
    main: "lib/orca/patchers/rule/next/index.ts:366",
    expected: {
      code: "E_CONFLICT",
      message: "Next.js 16 will not start with both middleware.ts and the proxy.ts setup writes",
      hint: `Next.js 16 renamed middleware.ts to proxy.ts. Move middleware.ts aside and rerun setup, then merge it into proxy.ts. ${FORCE_NOTE}`,
      details: { path: "middleware.ts", writes: "proxy.ts" },
      exitCode: 5,
    },
  },
  {
    error: new OrcaBoundaryVersionUnknownError(
      "Next.js 16 will not start with both proxy.ts and the middleware.ts setup writes",
      "proxy.ts",
      "middleware.ts",
    ),
    main: "lib/orca/patchers/rule/next/index.ts:366",
    expected: {
      code: "E_CONFLICT",
      message: "Next.js 16 will not start with both proxy.ts and the middleware.ts setup writes",
      hint: `Setup reads no Next.js version from package.json (a tag such as "latest" names none), so it writes the middleware.ts of Next 15. Pin next to the version range the app runs, such as "^16.0.0", and rerun setup: on Next 16 it then writes proxy.ts, and on Next 15 it leaves your proxy.ts alone. ${FORCE_NOTE}`,
      details: { path: "proxy.ts", writes: "middleware.ts" },
      exitCode: 5,
    },
  },
  {
    error: new OrcaZitadelConfigMissingError("zitadel.json was not found"),
    main: "lib/orca/patchers/rule/dev-port-move.ts:37",
    expected: {
      code: "E_VALIDATION",
      message: "zitadel.json was not found",
      hint: "Run `zitadel setup` first.",
      exitCode: 3,
    },
  },
  {
    case: "pinning the dev port",
    error: new OrcaPackageJsonMissingError("package.json is required to pin the dev port"),
    main: "lib/orca/patchers/rule/dev-script-port.ts:57",
    expected: {
      code: "E_VALIDATION",
      message: "package.json is required to pin the dev port",
      hint: "Run setup from a project that has a package.json.",
      exitCode: 3,
    },
  },
  {
    case: "adding the Angular dev script",
    error: new OrcaPackageJsonMissingError("package.json is required to add the dev script"),
    main: "lib/orca/patchers/rule/angular/templates.ts:189",
    expected: {
      code: "E_VALIDATION",
      message: "package.json is required to add the dev script",
      hint: "Run setup from a project that has a package.json.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaPatchFileMissingError("package.json is required to add Zitadel dependencies"),
    main: "lib/orca/patchers/rule/file-writer/ops/add-dep.ts:73",
    expected: {
      code: "E_VALIDATION",
      message: "package.json is required to add Zitadel dependencies",
      exitCode: 3,
    },
  },
  {
    error: new OrcaPatchOpEmptyError("An op needs at least one candidate path"),
    main: "lib/orca/patchers/rule/file-writer/operation.ts:106",
    expected: {
      code: "E_VALIDATION",
      message: "An op needs at least one candidate path",
      hint: "This is an internal patcher error — please report it if you hit it.",
      exitCode: 3,
    },
  },
  {
    case: "a path that is not a regular file",
    error: new OrcaInvalidError("app/login is not a regular file"),
    main: "lib/orca/patchers/rule/file-writer/operation.ts:116",
    expected: {
      code: "E_VALIDATION",
      message: "app/login is not a regular file",
      exitCode: 3,
    },
  },
  {
    case: "an angular.json with no project",
    error: new OrcaAngularProjectMissingError("No project found in angular.json"),
    main: "lib/orca/patchers/rule/angular/angular-json.ts:44",
    expected: {
      code: "E_VALIDATION",
      message: "No project found in angular.json",
      hint: 'Add "proxyConfig" to your serve target manually.',
      exitCode: 3,
    },
  },
  {
    case: "an angular.json with no serve target",
    error: new OrcaAngularServeTargetMissingError("No serve target in angular.json"),
    main: "lib/orca/patchers/rule/angular/angular-json.ts:57",
    expected: {
      code: "E_VALIDATION",
      message: "No serve target in angular.json",
      hint: 'Add "proxyConfig" to your serve options manually.',
      exitCode: 3,
    },
  },
  {
    case: "a solidStart() call with a non-object argument",
    error: new OrcaSolidStartOptionsError(
      "Cannot wire middleware: solidStart() is called with a non-object argument",
    ),
    main: "lib/orca/patchers/rule/solid-start/vite-config.ts:57",
    expected: {
      code: "E_VALIDATION",
      message: "Cannot wire middleware: solidStart() is called with a non-object argument",
      hint: 'Pass an options object to solidStart(), e.g. solidStart({ middleware: "./src/middleware.ts" }).',
      exitCode: 3,
    },
  },
  {
    case: "an unbalanced solidStart() call",
    error: new OrcaInvalidError("Malformed Vite config: unbalanced solidStart() call"),
    main: "lib/orca/patchers/rule/solid-start/vite-config.ts:118",
    expected: {
      code: "E_VALIDATION",
      message: "Malformed Vite config: unbalanced solidStart() call",
      exitCode: 3,
    },
  },
  {
    error: new OrcaRendererUnknownError('Unknown renderer "vue"', "react, web-component"),
    main: "lib/orca/patchers/rule/next/renderers/registry.ts:52",
    expected: {
      code: "E_VALIDATION",
      message: 'Unknown renderer "vue"',
      hint: "Available renderers: react, web-component.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaRendererPendingError(
      'Renderer "web-component" is declared but not yet published',
    ),
    main: "lib/orca/patchers/rule/next/renderers/registry.ts:58",
    expected: {
      code: "E_NOT_IMPLEMENTED",
      message: 'Renderer "web-component" is declared but not yet published',
      hint: "Use --renderer react for now; the <zitadel-flow> web component ships in a later package.",
      exitCode: 2,
    },
  },
  {
    error: new OrcaAngularJsonMissingError("Cannot wire Angular proxy: angular.json not found"),
    main: "lib/orca/patchers/rule/angular/angular-json.ts:22",
    expected: {
      code: "E_VALIDATION",
      message: "Cannot wire Angular proxy: angular.json not found",
      hint: "Run setup from an Angular project.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaAngularProjectAmbiguousError(
      "angular.json has multiple projects and no defaultProject to choose from",
      "app, admin",
    ),
    main: "lib/orca/patchers/rule/angular/angular-json.ts:32",
    expected: {
      code: "E_VALIDATION",
      message: "angular.json has multiple projects and no defaultProject to choose from",
      hint: `Set "defaultProject" in angular.json, or add "proxyConfig" to the right project's serve target manually. Projects: app, admin.`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaAngularRoutesNotInlineError(
      "Cannot wire Angular auth routes",
      "src/app/app.routes.ts",
    ),
    main: "lib/orca/patchers/rule/angular/angular-routes.ts:43",
    expected: {
      code: "E_VALIDATION",
      message: "Cannot wire Angular auth routes",
      hint: 'Set "routes" in src/app/app.routes.ts to an inline Routes array, or add /login, /register, and /profile manually.',
      exitCode: 3,
    },
  },
  {
    error: new OrcaProxyCredentialLeakError(
      "src/hooks.server.ts may forward ZITADEL_PROJECT_SECRET outside POST /sessions/exchange",
      EXCHANGE_PATH,
    ),
    main: "lib/orca/patchers/rule/proxy-credential-policy.ts:61",
    expected: {
      code: "E_VALIDATION",
      message:
        "src/hooks.server.ts may forward ZITADEL_PROJECT_SECRET outside POST /sessions/exchange",
      hint: `Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange or ${EXCHANGE_PATH} pathname and preserve caller-provided authorization.`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaSolidStartConfigMissingError(
      "Cannot edit the SolidStart Vite config: file not found",
    ),
    main: "lib/orca/patchers/rule/solid-start/vite-config.ts:24",
    expected: {
      code: "E_VALIDATION",
      message: "Cannot edit the SolidStart Vite config: file not found",
      hint: "Run setup from a SolidStart project that has a vite.config.ts.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaSolidStartPluginMissingError(
      "Cannot wire middleware: no solidStart() plugin call found in the Vite config",
    ),
    main: "lib/orca/patchers/rule/solid-start/vite-config.ts:35",
    expected: {
      code: "E_VALIDATION",
      message: "Cannot wire middleware: no solidStart() plugin call found in the Vite config",
      hint: "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.",
      exitCode: 3,
    },
  },
  {
    error: new OrcaSvelteKitEnvVarsError(
      `Could not find the env variables ${ENV_LABEL} declares`,
      ENV_LABEL,
      HOOK_VARIABLES,
    ),
    main: "lib/orca/patchers/rule/sveltekit/env-vars.ts:131",
    expected: {
      code: "E_VALIDATION",
      message: `Could not find the env variables ${ENV_LABEL} declares`,
      hint: `Export them as \`export const variables = defineEnvVars({ ... })\` from @sveltejs/kit/env, or declare ${HOOK_VARIABLES} there by hand.`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigFileMissingError(`Cannot edit ${CONFIG}: file not found`, CONFIG),
    main: "lib/orca/patchers/rule/utils/config-module.ts:58",
    expected: {
      code: "E_VALIDATION",
      message: `Cannot edit ${CONFIG}: file not found`,
      hint: `Run setup from a project that has ${CONFIG}.`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigUnparseableError(
      `Could not parse ${CONFIG}`,
      CONFIG,
      PARSE_ERROR,
      new SyntaxError(PARSE_ERROR),
    ),
    main: "lib/orca/patchers/rule/utils/config-module.ts:66",
    expected: {
      code: "E_VALIDATION",
      message: `Could not parse ${CONFIG}`,
      hint: `Ensure ${CONFIG} is valid, or apply the Zitadel changes manually.`,
      details: { cause: PARSE_ERROR },
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigCommonJsError(
      `${CONFIG} is a CommonJS module, which cannot be edited`,
      CONFIG,
    ),
    main: "lib/orca/patchers/rule/utils/config-module.ts:85",
    expected: {
      code: "E_VALIDATION",
      message: `${CONFIG} is a CommonJS module, which cannot be edited`,
      hint: 'The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.',
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigObjectMissingError(
      `Could not locate the config object in ${CONFIG}`,
      CONFIG,
    ),
    main: "lib/orca/patchers/rule/utils/config-module.ts:105",
    expected: {
      code: "E_VALIDATION",
      message: `Could not locate the config object in ${CONFIG}`,
      hint: `Add the Zitadel configuration to ${CONFIG} manually (see the SDK README).`,
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigObjectExpectedError(
      'Could not edit "runtimeConfig" in the config',
      "runtimeConfig",
    ),
    main: "lib/orca/patchers/rule/utils/config-module.ts:122",
    expected: {
      code: "E_VALIDATION",
      message: 'Could not edit "runtimeConfig" in the config',
      hint: 'Set "runtimeConfig" to an inline object literal, or add the Zitadel settings manually.',
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigArrayExpectedError('Could not edit "modules" in the config', "modules"),
    main: "lib/orca/patchers/rule/utils/config-module.ts:135",
    expected: {
      code: "E_VALIDATION",
      message: 'Could not edit "modules" in the config',
      hint: 'Set "modules" to an inline array literal, or add the Zitadel settings manually.',
      exitCode: 3,
    },
  },
  {
    error: new OrcaConfigUnwritableError(
      `Could not write ${CONFIG}`,
      CONFIG,
      PARSE_ERROR,
      new SyntaxError(PARSE_ERROR),
    ),
    main: "lib/orca/patchers/rule/utils/config-module.ts:157",
    expected: {
      code: "E_VALIDATION",
      message: `Could not write ${CONFIG}`,
      hint: `The edit left ${CONFIG} unparseable, so apply the Zitadel changes manually.`,
      details: { cause: PARSE_ERROR },
      exitCode: 3,
    },
  },
];
