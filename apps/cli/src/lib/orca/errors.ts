import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";

/**
 * Anything orca fails with on purpose.
 *
 * @remarks
 * A command that calls orca catches this, or one of its subclasses, and words
 * the failure itself. A failure nothing here anticipated is not one of these:
 * it bubbles as it was thrown.
 */
export abstract class OrcaError extends ZitadelLibError {
  /**
   * Nothing beyond the message: orca reports the facts of a failure only where its class says.
   *
   * @returns No facts.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {};
  }
}

/**
 * A directory with no app of a framework orca knows, or a framework orca has
 * no detector for: there is nothing to integrate with, so a new app could be
 * scaffolded into the directory.
 */
export class OrcaFrameworkMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_FRAMEWORK_NOT_DETECTED";
  override readonly retryable: boolean = false;
}

/**
 * An app of a framework orca knows, in a shape or of a version it does not
 * integrate.
 */
export class OrcaFrameworkUnsupportedError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly retryable: boolean = false;
}

/**
 * A request orca cannot act on as given: a scaffold that cannot start until
 * something in the way is dealt with (a Node the framework's tool refuses), a
 * file of the project a patch cannot edit because its content is not in a
 * shape the patch handles, or a renderer id that names none.
 */
export class OrcaInvalidError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A file a patch needs, and the project does not have.
 */
export class OrcaPatchFileMissingError extends OrcaError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A renderer that is declared and not published yet.
 */
export class OrcaRendererPendingError extends OrcaError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_NOT_IMPLEMENTED";
  override readonly retryable: boolean = false;
}

/**
 * A failure in this package: a bug, something that cannot happen unless the
 * code is wrong, or an external command a scaffold runs that could not be
 * spawned or exited non-zero.
 */
export class OrcaInternalError extends OrcaError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A request that conflicts with what the directory or the project already
 * holds: an app of another framework than the one asked for, a directory a
 * scaffold cannot start in, a file a patch would overwrite, or a file of the app
 * that would leave the integration broken.
 */
export class OrcaConflictError extends OrcaError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A directory holding an app of another framework than the one asked for.
 */
export class OrcaFrameworkMismatchError extends OrcaConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;

  /**
   * The framework id that was asked for.
   */
  readonly requested: string;

  /**
   * The framework id of the app the directory holds.
   */
  readonly detected: string;

  /**
   * The display name of the framework that was asked for.
   */
  readonly requestedName: string;

  /**
   * Make the failure for an app that is not the framework asked for.
   *
   * @param message - What was detected instead of what was asked for.
   * @param requested - The framework id that was asked for.
   * @param detected - The framework id of the app the directory holds.
   * @param requestedName - The display name of the framework that was asked for.
   */
  constructor(message: string, requested: string, detected: string, requestedName: string) {
    super(message);
    this.requested = requested;
    this.detected = detected;
    this.requestedName = requestedName;
  }

  /**
   * The framework asked for, and the one detected.
   *
   * @returns Both frameworks.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      requested: this.requested,
      detected: this.detected,
    };
  }
}

/**
 * A directory a scaffold cannot start in, because it already holds files.
 */
export class OrcaDirectoryNotEmptyError extends OrcaConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;

  /**
   * What makes the directory unfit, when it is more than holding files.
   */
  readonly reason: string | undefined;

  /**
   * The entries the directory holds.
   */
  readonly entries: readonly string[];

  /**
   * Make the failure for a directory that is not empty.
   *
   * @param message - Which directory is not empty.
   * @param reason - What makes the directory unfit, when it is more than holding files.
   * @param entries - The entries the directory holds.
   */
  constructor(message: string, reason: string | undefined, entries: readonly string[]) {
    super(message);
    this.reason = reason;
    this.entries = entries;
  }

  /**
   * What the directory holds.
   *
   * @returns Its entries.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      entries: this.entries,
    };
  }
}

/**
 * An app whose framework version is below the floor the CLI integrates.
 */
export class OrcaVersionBelowFloorError extends OrcaFrameworkUnsupportedError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The display name of the framework that is too old.
   */
  readonly displayName: string;

  /**
   * The oldest version the CLI integrates.
   */
  readonly versionFloor: string;

  /**
   * Why the floor is where it is, when the detector says so.
   */
  readonly note: string | undefined;

  /**
   * Make the failure for a framework version below the floor.
   *
   * @param message - Which version was found, and the floor it is below.
   * @param displayName - The display name of the framework that is too old.
   * @param versionFloor - The oldest version the CLI integrates.
   * @param note - Why the floor is where it is, when the detector says so.
   */
  constructor(
    message: string,
    displayName: string,
    versionFloor: string,
    note: string | undefined,
  ) {
    super(message);
    this.displayName = displayName;
    this.versionFloor = versionFloor;
    this.note = note;
    this.hint = `Upgrade the app to ${this.displayName} ${this.versionFloor} or later and rerun.${this.note === undefined ? "" : ` ${this.note}`}`;
  }
}

/**
 * A Next.js app on the Pages Router, which the CLI does not integrate.
 */
export class OrcaPagesRouterError extends OrcaFrameworkUnsupportedError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_UNSUPPORTED_PROJECT_SHAPE";
  override readonly hint: string =
    "Create an App Router project with an app/ or src/app/ directory.";
  override readonly retryable: boolean = false;
}

/**
 * A Node the framework's scaffolding tool refuses to run on.
 */
export class OrcaNodeUnsupportedError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The version of the Node this runs on.
   */
  readonly node: string;

  /**
   * The Node range the scaffolding tool declares.
   */
  readonly required: string;

  /**
   * The Node versions the range accepts, in words.
   */
  readonly accepted: string;

  /**
   * The display name of the framework that was to be scaffolded.
   */
  readonly displayName: string;

  /**
   * Make the failure for a Node the scaffolding tool refuses.
   *
   * @param message - Which tool needs which Node, and the one this is.
   * @param node - The version of the Node this runs on.
   * @param required - The Node range the scaffolding tool declares.
   * @param accepted - The Node versions the range accepts, in words.
   * @param displayName - The display name of the framework that was to be scaffolded.
   */
  constructor(
    message: string,
    node: string,
    required: string,
    accepted: string,
    displayName: string,
  ) {
    super(message);
    this.node = node;
    this.required = required;
    this.accepted = accepted;
    this.displayName = displayName;
  }

  /**
   * The Node that runs, and the Node the framework needs.
   *
   * @returns Both versions.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      node: this.node,
      required: this.required,
    };
  }
}

/**
 * An external command a scaffold runs that could not be spawned.
 */
export class OrcaCommandSpawnFailedError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The command that was run.
   */
  readonly command: string;

  /**
   * The arguments it was run with.
   */
  readonly args: readonly string[];

  /**
   * The code the spawn failed with.
   */
  readonly spawnCode: string;

  /**
   * Make the failure for a command that could not be spawned.
   *
   * @param message - Which command could not be spawned, and why.
   * @param command - The command that was run.
   * @param args - The arguments it was run with.
   * @param spawnCode - The code the spawn failed with.
   */
  constructor(message: string, command: string, args: readonly string[], spawnCode: string) {
    super(message);
    this.command = command;
    this.args = args;
    this.spawnCode = spawnCode;
  }

  /**
   * The command, its arguments, and the code it could not start with.
   *
   * @returns The command, the arguments and the code.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      command: this.command,
      args: this.args,
      code: this.spawnCode,
    };
  }
}

/**
 * An external command a scaffold runs that is not on the `PATH`.
 */
export class OrcaCommandNotFoundError extends OrcaCommandSpawnFailedError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = `Ensure '${this.command}' is installed and on PATH.`;
  override readonly retryable: boolean = false;
}

/**
 * An external command a scaffold runs that exited non-zero.
 */
export class OrcaCommandFailedError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The command that was run.
   */
  readonly command: string;

  /**
   * The arguments it was run with.
   */
  readonly args: readonly string[];

  /**
   * The directory it was run in.
   */
  readonly cwd: string;

  /**
   * What it wrote to stdout.
   */
  readonly stdout: string;

  /**
   * What it wrote to stderr.
   */
  readonly stderr: string;

  /**
   * Its stderr and stdout, joined and truncated; empty when it wrote nothing.
   */
  readonly output: string;

  /**
   * Make the failure for a command that exited non-zero.
   *
   * @param message - Which command exited with which status.
   * @param run - The command, its arguments and directory, and what it wrote.
   * @param run.command - The command that was run.
   * @param run.args - The arguments it was run with.
   * @param run.cwd - The directory it was run in.
   * @param run.stdout - What it wrote to stdout.
   * @param run.stderr - What it wrote to stderr.
   * @param run.output - Its stderr and stdout, joined and truncated.
   */
  constructor(
    message: string,
    run: {
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly stdout: string;
      readonly stderr: string;
      readonly output: string;
    },
  ) {
    super(message);
    this.command = run.command;
    this.args = run.args;
    this.cwd = run.cwd;
    this.stdout = run.stdout;
    this.stderr = run.stderr;
    this.output = run.output;
    this.hint =
      this.output === ""
        ? "Run the command directly for more detail."
        : `Command output:\n${this.output}`;
  }

  /**
   * The command, its arguments, where it ran and what it printed.
   *
   * @returns The command, the arguments, the folder and its output.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      command: this.command,
      args: this.args,
      cwd: this.cwd,
      stdout: this.stdout,
      stderr: this.stderr,
    };
  }
}

/**
 * A framework asked for that orca has no detector for.
 */
export class OrcaFrameworkUnknownError extends OrcaFrameworkMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_FRAMEWORK_NOT_DETECTED";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The framework ids orca has a detector for, joined with commas.
   */
  readonly supported: string;

  /**
   * Make the failure for a framework orca has no detector for.
   *
   * @param message - Which framework was asked for.
   * @param supported - The framework ids orca has a detector for, joined with commas.
   */
  constructor(message: string, supported: string) {
    super(message);
    this.supported = supported;
    this.hint = `Supported frameworks: ${this.supported}.`;
  }
}

/**
 * A framework orca can scaffold, and has no patcher to integrate.
 */
export class OrcaPatcherMissingError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Zitadel integration currently supports Next.js.";
  override readonly retryable: boolean = false;
}

/**
 * A plan with an op that names no path to write: a bug in a patcher.
 */
export class OrcaPatchOpEmptyError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "This is an internal patcher error — please report it if you hit it.";
  override readonly retryable: boolean = false;
}

/**
 * An Angular app with no `angular.json` to wire the dev proxy into.
 */
export class OrcaAngularJsonMissingError extends OrcaPatchFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * An `angular.json` with several projects and no `defaultProject` to pick one.
 */
export class OrcaAngularProjectAmbiguousError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The projects `angular.json` names, joined with commas.
   */
  readonly projects: string;

  /**
   * Make the failure for an `angular.json` with no project to choose.
   *
   * @param message - That there are several projects and no default.
   * @param projects - The projects `angular.json` names, joined with commas.
   */
  constructor(message: string, projects: string) {
    super(message);
    this.projects = projects;
    this.hint = `Set "defaultProject" in angular.json, or add "proxyConfig" to the right project's serve target manually. Projects: ${this.projects}.`;
  }
}

/**
 * An Angular routes file whose `routes` is not an inline array.
 */
export class OrcaAngularRoutesNotInlineError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The routes file, as the patch names it.
   */
  readonly label: string;

  /**
   * Make the failure for routes the patch cannot extend.
   *
   * @param message - That the auth routes cannot be wired.
   * @param label - The routes file, as the patch names it.
   */
  constructor(message: string, label: string) {
    super(message);
    this.label = label;
    this.hint = `Set "routes" in ${this.label} to an inline Routes array, or add /login, /register, and /profile manually.`;
  }
}

/**
 * A project with no `package.json` for a patch that edits its scripts.
 */
export class OrcaPackageJsonMissingError extends OrcaPatchFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A project with no `zitadel.json` for a patch that moves its issuer.
 */
export class OrcaZitadelConfigMissingError extends OrcaPatchFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A file the patch would write that holds something else, without `force`.
 */
export class OrcaFileOverwriteError extends OrcaConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;

  /**
   * The file that would be overwritten.
   */
  readonly path: string;

  /**
   * Make the failure for a file the patch refuses to overwrite.
   *
   * @param message - Which file would be overwritten.
   * @param path - The file that would be overwritten.
   */
  constructor(message: string, path: string) {
    super(message);
    this.path = path;
  }

  /**
   * The file setup would overwrite.
   *
   * @returns Its path.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      path: this.path,
    };
  }
}

/**
 * A Next.js request boundary of the app's that would sit beside the one setup
 * writes: the base of the three ways it conflicts.
 */
export abstract class OrcaBoundaryConflictError extends OrcaConflictError {
  /**
   * The app's own boundary file.
   */
  readonly existing: string;

  /**
   * The boundary file setup writes.
   */
  readonly target: string;

  /**
   * Make the failure for a boundary that conflicts with the one setup writes.
   *
   * @param message - Which two files conflict.
   * @param existing - The app's own boundary file.
   * @param target - The boundary file setup writes.
   */
  constructor(message: string, existing: string, target: string) {
    super(message);
    this.existing = existing;
    this.target = target;
  }

  /**
   * The boundary file in the way, and the one setup writes.
   *
   * @returns The file, as `path`, and what setup writes.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      path: this.existing,
      writes: this.target,
    };
  }
}

/**
 * A boundary of the app's under the same name as the one setup writes, so one
 * of the two would never run.
 */
export class OrcaBoundaryDuplicateError extends OrcaBoundaryConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A `middleware.*` of the app's beside the `proxy.ts` setup writes for Next 16.
 */
export class OrcaBoundaryRenamedError extends OrcaBoundaryConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A boundary of the app's beside the one setup writes, in an app whose Next.js
 * version setup cannot read.
 */
export class OrcaBoundaryVersionUnknownError extends OrcaBoundaryConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;
}

/**
 * A renderer id the registry does not declare.
 */
export class OrcaRendererUnknownError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The renderer ids that can be used, joined with commas.
   */
  readonly renderers: string;

  /**
   * Make the failure for a renderer id that names none.
   *
   * @param message - Which renderer id was given.
   * @param renderers - The renderer ids that can be used, joined with commas.
   */
  constructor(message: string, renderers: string) {
    super(message);
    this.renderers = renderers;
    this.hint = `Available renderers: ${this.renderers}.`;
  }
}

/**
 * A proxy of the app's that may forward the project secret beyond the
 * session exchange.
 */
export class OrcaProxyCredentialLeakError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The exchange path with the auth prefix, which the bearer may also reach.
   */
  readonly exchangePath: string;

  /**
   * Make the failure for a proxy that may leak the project secret.
   *
   * @param message - Which proxy may forward the secret.
   * @param exchangePath - The exchange path with the auth prefix.
   */
  constructor(message: string, exchangePath: string) {
    super(message);
    this.exchangePath = exchangePath;
    this.hint = `Review the proxy manually: restrict the bearer to the exact POST /sessions/exchange or ${this.exchangePath} pathname and preserve caller-provided authorization.`;
  }
}

/**
 * An app entry that mounts a root component other than the one setup writes.
 */
export class OrcaRootComponentMountError extends OrcaConflictError {
  override readonly category: ErrorCategory = "conflict";
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly retryable: boolean = false;

  /**
   * The entry module that mounts the root.
   */
  readonly entry: string;

  /**
   * The root component the entry mounts.
   */
  readonly mountedRoot: string;

  /**
   * The root component setup writes.
   */
  readonly root: string;

  /**
   * The import that would mount the root setup writes.
   */
  readonly statement: string;

  /**
   * Make the failure for an entry that mounts another root.
   *
   * @param message - Which entry mounts which root.
   * @param mount - The entry, the root it mounts, the root setup writes and its import.
   * @param mount.entry - The entry module that mounts the root.
   * @param mount.mountedRoot - The root component the entry mounts.
   * @param mount.root - The root component setup writes.
   * @param mount.statement - The import that would mount the root setup writes.
   */
  constructor(
    message: string,
    mount: {
      readonly entry: string;
      readonly mountedRoot: string;
      readonly root: string;
      readonly statement: string;
    },
  ) {
    super(message);
    this.entry = mount.entry;
    this.mountedRoot = mount.mountedRoot;
    this.root = mount.root;
    this.statement = mount.statement;
  }

  /**
   * The root the entry mounts, the entry, and the root setup writes.
   *
   * @returns The mounted root, as `path`, the entry and what setup writes.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      path: this.mountedRoot,
      entry: this.entry,
      writes: this.root,
    };
  }
}

/**
 * A SolidStart app with no Vite config to wire the middleware into.
 */
export class OrcaSolidStartConfigMissingError extends OrcaPatchFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;
}

/**
 * A SolidStart Vite config that registers no `solidStart()` plugin.
 */
export class OrcaSolidStartPluginMissingError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Ensure vite.config.ts registers the solidStart() plugin from @solidjs/start/config.";
  override readonly retryable: boolean = false;
}

/**
 * A SvelteKit env module that declares its variables in no shape the patch reads.
 */
export class OrcaSvelteKitEnvVarsError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The env module, as the patch names it.
   */
  readonly label: string;

  /**
   * The variables the hooks need, joined with commas.
   */
  readonly variables: string;

  /**
   * Make the failure for env variables the patch cannot find.
   *
   * @param message - Which module declares no variables it can read.
   * @param label - The env module, as the patch names it.
   * @param variables - The variables the hooks need, joined with commas.
   */
  constructor(message: string, label: string, variables: string) {
    super(message);
    this.label = label;
    this.variables = variables;
  }
}

/**
 * A config module a patch edits that the project does not have.
 */
export class OrcaConfigFileMissingError extends OrcaPatchFileMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly retryable: boolean = false;

  /**
   * The config module, as the patch names it.
   */
  readonly filename: string;

  /**
   * Make the failure for a config module that is not there.
   *
   * @param message - Which config module is missing.
   * @param filename - The config module, as the patch names it.
   */
  constructor(message: string, filename: string) {
    super(message);
    this.filename = filename;
  }
}

/**
 * A config module a patch edits, and why it cannot: the base of each shape it
 * does not handle.
 */
export abstract class OrcaConfigShapeError extends OrcaInvalidError {
  /**
   * The config module, as the patch names it.
   */
  readonly filename: string;

  /**
   * Make the failure for a config module the patch cannot edit.
   *
   * @param message - Which config module, and what is wrong with it.
   * @param filename - The config module, as the patch names it.
   * @param cause - The parser's failure, when there is one.
   */
  constructor(message: string, filename: string, cause?: unknown) {
    super(message, cause);
    this.filename = filename;
  }
}

/**
 * A config module that does not parse.
 */
export class OrcaConfigUnparseableError extends OrcaConfigShapeError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * What the parser said.
   */
  readonly parseError: string;

  /**
   * Make the failure for a config module that does not parse.
   *
   * @param message - Which config module does not parse.
   * @param filename - The config module, as the patch names it.
   * @param parseError - What the parser said.
   * @param cause - The parser's failure.
   */
  constructor(message: string, filename: string, parseError: string, cause: unknown) {
    super(message, filename, cause);
    this.parseError = parseError;
    this.hint = `Ensure ${this.filename} is valid, or apply the Zitadel changes manually.`;
  }

  /**
   * Why the config does not parse.
   *
   * @returns The parse error, as `cause`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      cause: this.parseError,
    };
  }
}

/**
 * A config module written as CommonJS, which the ESM edits cannot extend.
 */
export class OrcaConfigCommonJsError extends OrcaConfigShapeError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    'The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.';
  override readonly retryable: boolean = false;
}

/**
 * A config module with no default-exported object literal.
 */
export class OrcaConfigObjectMissingError extends OrcaConfigShapeError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    `Add the Zitadel configuration to ${this.filename} manually (see the SDK README).`;
  override readonly retryable: boolean = false;
}

/**
 * A config module the edit left unparseable.
 */
export class OrcaConfigUnwritableError extends OrcaConfigShapeError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * What the parser said about the edited code.
   */
  readonly parseError: string;

  /**
   * Make the failure for an edit that would leave the config unparseable.
   *
   * @param message - Which config module could not be written.
   * @param filename - The config module, as the patch names it.
   * @param parseError - What the parser said about the edited code.
   * @param cause - The parser's failure.
   */
  constructor(message: string, filename: string, parseError: string, cause: unknown) {
    super(message, filename, cause);
    this.parseError = parseError;
    this.hint = `The edit left ${this.filename} unparseable, so apply the Zitadel changes manually.`;
  }

  /**
   * Why the config does not parse.
   *
   * @returns The parse error, as `cause`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      cause: this.parseError,
    };
  }
}

/**
 * A config key the patch edits that holds something other than an inline
 * literal: the base of the object and array shapes.
 */
export abstract class OrcaConfigKeyError extends OrcaInvalidError {
  /**
   * The key that holds no inline literal.
   */
  readonly key: string;

  /**
   * Make the failure for a key the patch cannot edit.
   *
   * @param message - Which key could not be edited.
   * @param key - The key that holds no inline literal.
   */
  constructor(message: string, key: string) {
    super(message);
    this.key = key;
  }
}

/**
 * A config key that should hold an inline object literal.
 */
export class OrcaConfigObjectExpectedError extends OrcaConfigKeyError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    `Set "${this.key}" to an inline object literal, or add the Zitadel settings manually.`;
  override readonly retryable: boolean = false;
}

/**
 * A config key that should hold an inline array literal.
 */
export class OrcaConfigArrayExpectedError extends OrcaConfigKeyError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    `Set "${this.key}" to an inline array literal, or add the Zitadel settings manually.`;
  override readonly retryable: boolean = false;
}

/**
 * A framework asked to be scaffolded that no scaffolder supports.
 */
export class OrcaScaffolderMissingError extends OrcaInternalError {
  override readonly category: ErrorCategory = "fault";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;
  override readonly retryable: boolean = false;

  /**
   * The framework ids that can be scaffolded, joined with commas.
   */
  readonly frameworks: string;

  /**
   * Make the failure for a framework no scaffolder supports.
   *
   * @param message - Which framework was asked for.
   * @param frameworks - The framework ids that can be scaffolded, joined with commas.
   */
  constructor(message: string, frameworks: string) {
    super(message);
    this.frameworks = frameworks;
    this.hint = `Available frameworks: ${this.frameworks}.`;
  }
}

/**
 * An `angular.json` that names no project to wire the dev proxy into.
 */
export class OrcaAngularProjectMissingError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = 'Add "proxyConfig" to your serve target manually.';
  override readonly retryable: boolean = false;
}

/**
 * An Angular project in `angular.json` with no serve target to wire the dev
 * proxy into.
 */
export class OrcaAngularServeTargetMissingError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = 'Add "proxyConfig" to your serve options manually.';
  override readonly retryable: boolean = false;
}

/**
 * A SolidStart Vite config that calls `solidStart()` with something other
 * than an options object.
 */
export class OrcaSolidStartOptionsError extends OrcaInvalidError {
  override readonly category: ErrorCategory = "invalid";
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    'Pass an options object to solidStart(), e.g. solidStart({ middleware: "./src/middleware.ts" }).';
  override readonly retryable: boolean = false;
}
