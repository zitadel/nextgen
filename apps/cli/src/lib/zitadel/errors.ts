import type { ProviderSelection } from "@zitadel/config/idp";

import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ToggleableMethod } from "@/lib/zitadel/resources/schemas/types";
import type { FlowIssue, FlowMethodUse } from "@/lib/zitadel/rules/types";

/**
 * Anything `lib/zitadel` fails with.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place.
 */
export class ZitadelConfigError extends ZitadelLibError {
  /** The kind of failure; a subclass states its own. */
  override readonly category: ErrorCategory = "invalid";

  /** Whether the same request may succeed on a later attempt, with nothing changed. */
  override readonly retryable: boolean = false;

  /** The stable product code the failure is reported with; a subclass states its own. */
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The failure's facts, keyed as the package reports them: a project file as `file` and an operating system's error code as `code`.
   *
   * @returns The facts, by name.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      Object.entries(super.details).map(([key, value]) => {
        return [key === "path" ? "file" : key === "errno" ? "code" : key, value];
      }),
    );
  }
}

/**
 * A change that turns off a method a login flow still uses.
 */
export class ZitadelConfigFlowMethodInUseError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The project-relative path of the schema the method was turned off in.
   */
  readonly file: string;

  /**
   * The method being turned off.
   */
  readonly method: ToggleableMethod;

  /**
   * Every issue the change brings to the flows.
   */
  readonly issues: readonly FlowIssue[];

  /**
   * Each step that still uses the method.
   */
  readonly uses: readonly FlowMethodUse[];

  /**
   * Make the failure for these steps.
   *
   * @param message - What the change would break, naming each step.
   * @param facts - The schema, the method, the issues and the steps that use it.
   */
  constructor(
    message: string,
    facts: {
      readonly file: string;
      readonly method: ToggleableMethod;
      readonly issues: readonly FlowIssue[];
      readonly uses: readonly FlowMethodUse[];
    },
  ) {
    super(message);
    this.file = facts.file;
    this.method = facts.method;
    this.issues = facts.issues;
    this.uses = facts.uses;
  }

  /**
   * The flow, its issues, and the steps that still use the method, as `--json` reports them.
   *
   * @returns The file, the issues and the steps.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.file,
      issues: issueDetailsOf(this.issues),
      steps: stepDetailsOf(this.uses),
    };
  }
}

/**
 * A change that would make a login flow stop validating.
 */
export class ZitadelConfigFlowBrokenError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Fix the steps named above, then run the command again.";

  /**
   * The project-relative path of the schema whose edit was checked.
   */
  readonly file: string;

  /**
   * Every issue found in the flows.
   */
  readonly issues: readonly FlowIssue[];

  /**
   * Make the failure for these issues.
   *
   * @param message - What is wrong, naming each issue.
   * @param facts - The schema whose edit was checked, and the issues found.
   */
  constructor(
    message: string,
    facts: {
      readonly file: string;
      readonly issues: readonly FlowIssue[];
    },
  ) {
    super(message);
    this.file = facts.file;
    this.issues = facts.issues;
  }

  /**
   * The flow, and its issues as `--json` reports them.
   *
   * @returns The file, and the issues.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.file,
      issues: issueDetailsOf(this.issues),
    };
  }
}

/**
 * A login flow with errors of its own, so it cannot be checked against a changed schema.
 */
export class ZitadelConfigFlowUncheckedError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The project-relative path of the schema whose edit was checked.
   */
  readonly file: string;

  /**
   * Every issue found in the flows.
   */
  readonly issues: readonly FlowIssue[];

  /**
   * Make the failure for these issues.
   *
   * @param message - What is wrong, naming each issue.
   * @param facts - The schema whose edit was checked, and the issues found.
   */
  constructor(
    message: string,
    facts: {
      readonly file: string;
      readonly issues: readonly FlowIssue[];
    },
  ) {
    super(message);
    this.file = facts.file;
    this.issues = facts.issues;
  }

  /**
   * The flow, and its issues as `--json` reports them.
   *
   * @returns The file, and the issues.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.file,
      issues: issueDetailsOf(this.issues),
    };
  }
}

/**
 * One file that could not be taken as configuration, and why.
 */
export type FileProblem = {
  /**
   * The file's project-relative path.
   */
  readonly path: string;

  /**
   * What is wrong with it.
   */
  readonly problem: string;
};

/**
 * Configuration files their contract rules refuse, each named with what is
 * wrong with it.
 */
export class ZitadelConfigFilesBrokenError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Fix the files named above, then run the command again; nothing was changed.";

  /**
   * Each file refused, and why.
   */
  readonly problems: readonly FileProblem[];

  /**
   * Make the failure for these files.
   *
   * @param problems - Each file refused, and why.
   */
  constructor(problems: readonly FileProblem[]) {
    const paths = new Set(
      problems.map((entry) => {
        return entry.path;
      }),
    );
    super(
      [
        `${paths.size} configuration ${new Intl.PluralRules("en").select(paths.size) === "one" ? "file is" : "files are"} not valid:`,
        ...problems.map((entry) => {
          return `  - ${entry.path}: ${entry.problem}`;
        }),
      ].join("\n"),
    );
    this.problems = problems;
  }
}

/**
 * A configuration with nothing in `.zitadel/` a release could carry.
 */
export class ZitadelConfigNothingToDeployError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure.
   */
  constructor() {
    super("There is nothing in .zitadel/ to deploy");
  }
}

/**
 * A connection asked to take a client id other than the one its file holds.
 */
export class ZitadelConfigClientIdMismatchError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Edit the connection file to change its client id, or run the command without one to reuse it.";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * The client id the file holds.
   */
  readonly stored: string;

  /**
   * The client id the run was given.
   */
  readonly supplied: string;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection.
   * @param stored - The client id the file holds.
   * @param supplied - The client id the run was given.
   */
  constructor(path: string, stored: string, supplied: string) {
    super(`${path} already uses client id ${stored}, not ${supplied}`);
    this.path = path;
    this.stored = stored;
    this.supplied = supplied;
  }

  /**
   * The connection file, and the client ids it holds and was given.
   *
   * @returns The file, and both client ids.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
      stored_client_id: this.stored,
      supplied_client_id: this.supplied,
    };
  }
}

/**
 * A setting a connection file holds that the platform would not take.
 */
export class ZitadelConfigSettingUnusableError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Fix it in that file, or choose another slug.";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * The connection's slug.
   */
  readonly slug: string;

  /**
   * Make the failure for this setting.
   *
   * @param path - The project-relative path of the connection.
   * @param slug - The connection's slug.
   * @param what - The setting, as a sentence names it ("an issuer").
   * @param problem - Why it cannot be used.
   */
  constructor(path: string, slug: string, what: string, problem: string) {
    super(`${path} holds ${what} that cannot be used: ${problem}`);
    this.path = path;
    this.slug = slug;
  }
}

/**
 * A file or directory that cannot be read for a reason other than the
 * operating system refusing this process, such as a file where a directory
 * should be.
 */
export class ZitadelConfigPathUnreadableError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Check that the file is readable, then run the command again.";

  /**
   * The project-relative path that cannot be read.
   */
  readonly path: string;

  /**
   * The operating system's error code, when it gave one.
   */
  readonly errno: string | undefined;

  /**
   * Make the failure for this path.
   *
   * @param path - The project-relative path that cannot be read.
   * @param errno - The operating system's error code, when it gave one.
   * @param cause - The failure that stopped the read.
   */
  constructor(path: string, errno: string | undefined, cause?: unknown) {
    super(`${path} cannot be read${errno === undefined ? "" : ` (${errno})`}`, cause);
    this.path = path;
    this.errno = errno;
  }
}

/**
 * Two things the configuration cannot hold at once, such as two connections
 * with one slug, or a new connection whose file name another one already has.
 */
export class ZitadelConfigResourceClashError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
}

/**
 * A slug that already names a connection with no issuer, which is not an OIDC
 * connection to reuse.
 */
export class ZitadelConfigConnectionNotOidcError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Fix the file, or choose another slug, then run the command again.";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * The slug it is named.
   */
  readonly slug: string;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection.
   * @param slug - The slug it is named.
   */
  constructor(path: string, slug: string) {
    super(`${path} is already named ${slug} and is not an OIDC connection`);
    this.path = path;
    this.slug = slug;
  }
}

/**
 * A slug that already names a connection to another issuer.
 */
export class ZitadelConfigConnectionIssuerClashError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. Choose another slug for this connection, then move the schemas and flows that name the old one to it.";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * The slug it is named.
   */
  readonly slug: string;

  /**
   * The issuer the run was given.
   */
  readonly issuer: string;

  /**
   * The issuer the file holds; `null` when it holds none.
   */
  readonly existingIssuer: string | null;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection.
   * @param slug - The slug it is named.
   * @param issuer - The issuer the run was given.
   * @param existingIssuer - The issuer the file holds, if any.
   */
  constructor(path: string, slug: string, issuer: string, existingIssuer: string | undefined) {
    super(
      `${path} is already named ${slug} and ${existingIssuer === undefined ? `is not an OIDC connection to ${issuer}` : `connects to ${existingIssuer}, not ${issuer}`}`,
    );
    this.path = path;
    this.slug = slug;
    this.issuer = issuer;
    this.existingIssuer = existingIssuer ?? null;
  }
}

/**
 * A catalog provider's connection file name that another connection already
 * has.
 */
export class ZitadelConfigProviderFileTakenError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string = "Rename or remove that file, then run the command again.";

  /**
   * The project-relative path that is taken.
   */
  readonly path: string;

  /**
   * The slug of the connection the file holds.
   */
  readonly slug: string;

  /**
   * Make the failure for this file.
   *
   * @param path - The project-relative path that is taken.
   * @param wanted - The slug the file was wanted for.
   * @param slug - The slug of the connection the file holds.
   */
  constructor(path: string, wanted: string, slug: string) {
    super(`${path} already exists and is not the ${wanted} connection`);
    this.path = path;
    this.slug = slug;
  }
}

/**
 * A custom connection's file name that another connection already has.
 */
export class ZitadelConfigConnectionFileTakenError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Rename or remove that file, or choose another slug, then run the command again.";

  /**
   * The project-relative path that is taken.
   */
  readonly path: string;

  /**
   * The slug of the connection the file holds.
   */
  readonly slug: string;

  /**
   * Make the failure for this file.
   *
   * @param path - The project-relative path that is taken.
   * @param wanted - The slug the file was wanted for.
   * @param slug - The slug of the connection the file holds.
   */
  constructor(path: string, wanted: string, slug: string) {
    super(`${path} already exists and is not the ${wanted} connection`);
    this.path = path;
    this.slug = slug;
  }
}

/**
 * Something the run named that the configuration does not have.
 */
export class ZitadelConfigResourceMissingError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
}

/**
 * A user schema asked for by a name no schema has, or asked for in a
 * configuration that has none.
 */
export class ZitadelConfigSchemaMissingError extends ZitadelConfigResourceMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";

  /**
   * Every schema the configuration has; none when it has no schema at all.
   */
  readonly known: readonly UserSchema[];

  /**
   * The name asked for, or `null` when none was.
   */
  readonly requested: string | null;

  /**
   * Make the failure for this name.
   *
   * @param requested - The name asked for, if any.
   * @param known - Every schema the configuration has.
   */
  constructor(requested: string | undefined, known: readonly UserSchema[]) {
    const unnamed = requested === undefined || known.length === 0;
    const message = unnamed
      ? "There is no user schema under .zitadel/schemas"
      : `No user schema is named ${requested}`;
    super(message);
    this.requested = requested ?? null;
    this.known = known;
  }

  /**
   * The schema asked for, and the names of those there are.
   *
   * @returns The request, and the known names.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      requested: this.requested,
      known: this.known.map((schema) => {
        return schema.name;
      }),
    };
  }
}

/**
 * A user schema asked for in a way more than one schema fits: by a name that
 * is one schema's file name and another's `objectType`, or by no name where
 * there are several.
 *
 * @remarks
 * Refused rather than guessed, since editing the wrong schema is worse than
 * asking which was meant.
 */
export class ZitadelConfigSchemaAmbiguousError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Every schema that fits.
   */
  readonly candidates: readonly UserSchema[];

  /**
   * The name asked for, or `null` when none was.
   */
  readonly requested: string | null;

  /**
   * Make the failure for these schemas.
   *
   * @param requested - The name asked for, if any.
   * @param candidates - Every schema that fits.
   */
  constructor(requested: string | undefined, candidates: readonly UserSchema[]) {
    const message =
      requested === undefined
        ? "There is more than one user schema, and none was named"
        : `More than one user schema is named ${requested}`;
    super(message);
    this.requested = requested ?? null;
    this.candidates = candidates;
  }

  /**
   * The schema asked for, and the names of those that answer to it.
   *
   * @returns The request, and the candidates' names.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      requested: this.requested,
      candidates: this.candidates.map((schema) => {
        return schema.name;
      }),
    };
  }
}

/**
 * The user schema a change would leave with no way to sign in.
 */
export type NoSignInLeft = {
  /**
   * The schema's file.
   */
  readonly path: string;

  /**
   * The schema's name.
   */
  readonly schema: string;

  /**
   * What is being turned off: a method, or a provider.
   */
  readonly disabling: string;

  /**
   * The methods the schema enables before the change.
   */
  readonly usable: readonly string[];

  /**
   * The methods the schema could enable instead.
   */
  readonly alternatives: readonly string[];
};

/**
 * A change that turns off the last way to sign in to a user schema.
 *
 * @remarks
 * The server allows it, for a schema whose users are only managed through the
 * API, so the change is made only when the caller asks for it again with
 * `force`. It implements {@link NoSignInLeft}, so its fields cannot drift from
 * what it is made from.
 */
export class ZitadelConfigEditLockoutError extends ZitadelConfigError implements NoSignInLeft {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The schema's file.
   */
  readonly path: string;

  /**
   * The schema's name.
   */
  readonly schema: string;

  /**
   * What is being turned off: a method, or a provider.
   */
  readonly disabling: string;

  /**
   * The methods the schema enables before the change.
   */
  readonly usable: readonly string[];

  /**
   * The methods the schema could enable instead.
   */
  readonly alternatives: readonly string[];

  /**
   * Make the failure for this schema.
   *
   * @param input - The schema, what is being turned off, and what it has left.
   */
  constructor(input: NoSignInLeft) {
    super(`${input.path} would have no way to sign in left`);
    this.path = input.path;
    this.schema = input.schema;
    this.disabling = input.disabling;
    this.usable = input.usable;
    this.alternatives = input.alternatives;
  }

  /**
   * The schema file, and the methods left to sign in with.
   *
   * @returns The file, the methods still usable and the alternatives.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
      usable: this.usable,
      alternatives: this.alternatives,
    };
  }
}

/**
 * A new file that would replace one already there.
 *
 * @remarks
 * Raised by every store alike, so a caller that scaffolds can say what to do
 * whichever store it has.
 */
export class ZitadelConfigFileExistsError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Move or rename the file that is already there, then run the command again.";

  /**
   * The project-relative path that is already taken.
   */
  readonly path: string;

  /**
   * Make the failure for this path.
   *
   * @param path - The project-relative path that is already taken.
   */
  constructor(path: string) {
    super(`${path} already exists`);
    this.path = path;
  }
}

/**
 * A provider a new project was to offer that already has a connection, which
 * a scaffold never replaces.
 *
 * @remarks
 * A connection may hold a client id someone registered with the vendor and a
 * slug the schemas and flows already name, so the file is the developer's,
 * with or without `force`. The provider is kept, so the caller can say how to
 * enable it with the connection that is there.
 */
export class ZitadelConfigConnectionExistsError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "A connection file is yours to keep, so it is never replaced or removed. Remove it to scaffold a fresh one, or keep it and enable the provider to reuse it.";

  /**
   * The project-relative path of the connection already there.
   */
  readonly path: string;

  /**
   * The provider, as it was chosen.
   */
  readonly selection: ProviderSelection;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection already there.
   * @param selection - The provider, as it was chosen.
   */
  constructor(path: string, selection: ProviderSelection) {
    super(`${path} already exists`);
    this.path = path;
    this.selection = selection;
  }

  /**
   * The connection file that is already there.
   *
   * @returns Its path, as `file`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
    };
  }
}

/**
 * A file or directory that cannot be read because the operating system refused
 * to let this process read it.
 */
export class ZitadelConfigFileUnreadableError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";
  override readonly hint: string = "Check that the file is readable, then run the command again.";

  /**
   * The project-relative path that cannot be read.
   */
  readonly path: string;

  /**
   * The operating system's error code.
   */
  readonly errno: string;

  /**
   * Make the failure for this path.
   *
   * @param path - The project-relative path that cannot be read.
   * @param errno - The operating system's error code.
   * @param cause - The failure that stopped the read.
   * @param message - What went wrong, when it is more than the path that
   *   cannot be read.
   */
  constructor(
    path: string,
    errno: string,
    cause?: unknown,
    message = `${path} cannot be read (${errno})`,
  ) {
    super(message, cause);
    this.path = path;
    this.errno = errno;
  }
}

/**
 * A `$file` reference whose file is there but that the operating system
 * refused to let this process read. It is a file that cannot be read, so a
 * caller that refuses one refuses the other the same way.
 */
export class ZitadelConfigReferenceUnreadableError extends ZitadelConfigFileUnreadableError {
  override readonly hint: string = "Create the referenced file or fix the path.";
  /**
   * The reference, as the file holding it wrote it.
   */
  readonly ref: string;

  /**
   * Make the failure for this reference.
   *
   * @param path - The project-relative path of the file holding the reference.
   * @param ref - The reference, as that file wrote it.
   * @param errno - The operating system's error code.
   * @param cause - The failure that stopped the read.
   */
  constructor(path: string, ref: string, errno: string, cause?: unknown) {
    super(path, errno, cause, `$file ${JSON.stringify(ref)} cannot be read`);
    this.ref = ref;
  }
}

/** A schema whose sign-in methods live at its `url`, which a command cannot edit. */
export class ZitadelConfigSchemaExternalError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Its sign-in methods live in the schema at its url, which the server fetches. Edit x-auth-methods there instead.";

  /** The pointer file of the external schema. */
  readonly file: string;

  /**
   * Make the failure.
   *
   * @param file - The pointer file of the external schema.
   */
  constructor(file: string) {
    super(`${file} points at an external schema`);
    this.file = file;
  }
}

/** A bug in this package: something that cannot happen unless the code is wrong. */
export class ZitadelConfigInternalError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A release that would carry more than one branding.
 */
export class ZitadelConfigBrandingDuplicatedError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "A project has a single branding; keep one descriptor under .zitadel/branding/.";

  /**
   * Make the failure for this many descriptors.
   *
   * @param count - How many branding descriptors `.zitadel/branding/` holds.
   */
  constructor(count: number) {
    super(`A release carries at most one branding, but .zitadel/branding/ holds ${count}`);
  }
}

/**
 * A password policy file a scaffold was told to keep that is not a sound
 * password policy.
 */
export class ZitadelConfigPasswordPolicyInvalidError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The project-relative path of the policy file.
   */
  readonly path: string;

  /**
   * Make the failure for this file.
   *
   * @param path - The project-relative path of the policy file.
   */
  constructor(path: string) {
    super(`${path} is not a valid password policy`);
    this.path = path;
  }
}

/**
 * A sign-up policy file a scaffold was told to keep that is not a sound
 * sign-up policy.
 */
export class ZitadelConfigSignupPolicyInvalidError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The project-relative path of the policy file.
   */
  readonly path: string;

  /**
   * Make the failure for this file.
   *
   * @param path - The project-relative path of the policy file.
   */
  constructor(path: string) {
    super(`${path} is not a valid sign-up policy`);
    this.path = path;
  }
}

/**
 * A handle the server gave that cannot name a file: one named after it would
 * land outside its kind's directory or be one a read never loads.
 */
export class ZitadelConfigHandleInvalidError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "A handle must be a single name, without slashes or dots that climb out of its directory.";

  /**
   * The handle, as the server gave it.
   */
  readonly handle: string;

  /**
   * Make the failure for this handle.
   *
   * @param handle - The handle, as the server gave it.
   */
  constructor(handle: string) {
    super(`${JSON.stringify(handle)} cannot be the name of a file`);
    this.handle = handle;
  }
}

/**
 * Several files that do not read as configuration and all hold one handle.
 */
export class ZitadelConfigHandleClashError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string = "Remove or fix all but one of them, then run the command again.";

  /**
   * The handle they hold.
   */
  readonly handle: string;

  /**
   * The project-relative paths of the files.
   */
  readonly paths: readonly string[];

  /**
   * Make the failure for these files.
   *
   * @param handle - The handle they hold.
   * @param paths - The project-relative paths of the files.
   */
  constructor(handle: string, paths: readonly string[]) {
    super(
      `${new Intl.ListFormat("en", { type: "conjunction" }).format(paths)} both hold ${handle}`,
    );
    this.handle = handle;
    this.paths = paths;
  }
}

/**
 * More than one connection to the provider a run enables.
 */
export class ZitadelConfigConnectionDuplicatedError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Keep the one this project should use and remove the others, then run the command again.";

  /**
   * The provider's slug.
   */
  readonly provider: string;

  /**
   * The project-relative paths of the connections.
   */
  readonly paths: readonly string[];

  /**
   * Make the failure for these connections.
   *
   * @param provider - The provider's slug.
   * @param displayName - The provider's name, as a person reads it.
   * @param paths - The project-relative paths of the connections.
   */
  constructor(provider: string, displayName: string, paths: readonly string[]) {
    super(`More than one ${displayName} connection exists: ${paths.join(", ")}`);
    this.provider = provider;
    this.paths = paths;
  }

  /**
   * The provider, and the files that each hold a connection to it.
   *
   * @returns The provider, and the files.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      provider: this.provider,
      files: this.paths,
    };
  }
}

/**
 * More than one connection named by one slug.
 */
export class ZitadelConfigSlugDuplicatedError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "A slug names one connection. Remove or rename all but one, then run the command again.";

  /**
   * The slug.
   */
  readonly slug: string;

  /**
   * The project-relative paths of the connections.
   */
  readonly paths: readonly string[];

  /**
   * Make the failure for these connections.
   *
   * @param slug - The slug.
   * @param paths - The project-relative paths of the connections.
   */
  constructor(slug: string, paths: readonly string[]) {
    super(`More than one connection is named ${slug}: ${paths.join(", ")}`);
    this.slug = slug;
    this.paths = paths;
  }

  /**
   * The slug, and the files that each hold a connection by it.
   *
   * @returns The slug, and the files.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      slug: this.slug,
      files: this.paths,
    };
  }
}

/**
 * A provider to stop offering that nothing knows: no schema offers it, and no
 * connection or catalog entry has its name.
 */
export class ZitadelConfigProviderUnknownError extends ZitadelConfigResourceMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
  override readonly hint: string;

  /**
   * The provider, as it was asked for.
   */
  readonly requested: string;

  /**
   * The providers the schema offers.
   */
  readonly offered: readonly string[];

  /**
   * The slugs of the project's connections.
   */
  readonly connections: readonly string[];

  /**
   * Make the failure for this provider.
   *
   * @param schema - The schema's name.
   * @param requested - The provider, as it was asked for.
   * @param offered - The providers the schema offers.
   * @param connections - The slugs of the project's connections.
   */
  constructor(
    schema: string,
    requested: string,
    offered: readonly string[],
    connections: readonly string[],
  ) {
    super(`${schema} has no provider named ${requested}`);
    this.requested = requested;
    this.offered = offered;
    this.connections = connections;
    this.hint = `${schema} offers: ${offered.join(", ") || "none"}. Connections under .zitadel/idps/: ${connections.join(", ") || "none"}.`;
  }
}

/**
 * A new connection whose file is already a connection with its slug, to
 * another issuer.
 */
export class ZitadelConfigConnectionProviderMismatchError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * The slug it is named.
   */
  readonly slug: string;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection.
   * @param slug - The slug it is named.
   * @param displayName - The provider's name, as a person reads it.
   * @param issuer - The issuer it was wanted for, or `the same`.
   */
  constructor(path: string, slug: string, displayName: string, issuer: string) {
    super(
      `${path} is a connection called ${slug}, but not to ${displayName}: its issuer is not ${issuer}`,
    );
    this.path = path;
    this.slug = slug;
  }
}

/**
 * A connection whose client id and client secret are read from one variable.
 */
export class ZitadelConfigCredentialsDoubledError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.";

  /**
   * The connection's slug.
   */
  readonly slug: string;

  /**
   * The variable both credentials point at.
   */
  readonly variable: string;

  /**
   * Make the failure for this connection.
   *
   * @param slug - The connection's slug.
   * @param variable - The variable both credentials point at.
   */
  constructor(slug: string, variable: string) {
    super(`This connection points both credentials at ${variable}`);
    this.slug = slug;
    this.variable = variable;
  }
}

/**
 * Two connections whose credentials are read from one variable.
 */
export class ZitadelConfigVariableSharedError extends ZitadelConfigResourceClashError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
  override readonly hint: string =
    "Point one of them at a variable of its own, then run the command again.";

  /**
   * The project-relative path of the other connection.
   */
  readonly path: string;

  /**
   * This connection's slug.
   */
  readonly slug: string;

  /**
   * The other connection's slug.
   */
  readonly otherSlug: string;

  /**
   * The variable both read.
   */
  readonly variable: string;

  /**
   * Make the failure for these connections.
   *
   * @param path - The project-relative path of the other connection.
   * @param slug - This connection's slug.
   * @param otherSlug - The other connection's slug.
   * @param variable - The variable both read.
   */
  constructor(path: string, slug: string, otherSlug: string, variable: string) {
    super(`${path} and ${slug} both use ${variable}`);
    this.path = path;
    this.slug = slug;
    this.otherSlug = otherSlug;
    this.variable = variable;
  }
}

/**
 * A region of a file an edit writes that is not the shape it writes, so
 * rewriting it would discard what was written by hand.
 */
export class ZitadelConfigRegionUneditableError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "This command edits that region, and it is not the shape it edits. Fix it against the dialect in .zitadel/meta/, then run the command again.";

  /**
   * The project-relative path of the file.
   */
  readonly path: string;

  /**
   * What is wrong with the region.
   */
  readonly region: string;

  /**
   * Make the failure for this region.
   *
   * @param path - The project-relative path of the file.
   * @param region - What is wrong with the region.
   */
  constructor(path: string, region: string) {
    super(`${path}: ${region}`);
    this.path = path;
    this.region = region;
  }
}

/**
 * A user schema no login flow runs against, so no flow can offer a provider.
 */
export class ZitadelConfigFlowMissingError extends ZitadelConfigResourceMissingError {
  override readonly category: ErrorCategory = "missing";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_NOT_FOUND";
  override readonly hint: string =
    "The provider is offered by a flow, and none of the files under .zitadel/flows/ names this schema. Check that the flow's user_schema names the schema's objectType.";

  /**
   * The project-relative path of the schema.
   */
  readonly path: string;

  /**
   * Make the failure for this schema.
   *
   * @param name - The schema's name.
   * @param path - The project-relative path of the schema.
   */
  constructor(name: string, path: string) {
    super(`No login flow runs against ${name}`);
    this.path = path;
  }

  /**
   * The schema no flow names.
   *
   * @returns Its path, as `schema`.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      schema: this.path,
    };
  }
}

/**
 * A step with an action named like an outcome an edit offering a provider
 * writes on it: a legacy outcome it would rename, or one it would add.
 */
export class ZitadelConfigActionClashError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The step's name.
   */
  readonly step: string;

  /**
   * The action whose name the outcome would take.
   */
  readonly action: string;

  /**
   * Make the failure for this step.
   *
   * @param message - What the edit would do, naming the step and the action.
   * @param step - The step's name.
   * @param action - The action whose name the outcome would take.
   */
  constructor(message: string, step: string, action: string) {
    super(message);
    this.step = step;
    this.action = action;
  }
}

/**
 * A step whose legacy outcome declares a purpose or an action, which the key
 * it is renamed to cannot.
 */
export class ZitadelConfigRenameRouteLossError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * The step's name.
   */
  readonly step: string;

  /**
   * The outcome the previous CLI wrote.
   */
  readonly transition: string;

  /**
   * Make the failure for this step.
   *
   * @param step - The step's name.
   * @param transition - The outcome the previous CLI wrote.
   * @param next - The key it is renamed to.
   */
  constructor(step: string, transition: string, next: string) {
    super(
      `steps.${step}: transition "${transition}" declares purpose or action, which "${next}" cannot`,
    );
    this.step = step;
    this.transition = transition;
  }
}

/**
 * A user schema asked to take passwords with no identifier to check one
 * against.
 */
export class ZitadelConfigIdentifierMissingError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    'A password is checked against the user found by the schema\'s identifier. Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.';

  /**
   * The project-relative path of the schema.
   */
  readonly path: string;

  /**
   * Make the failure for this schema.
   *
   * @param path - The project-relative path of the schema.
   */
  constructor(path: string) {
    super(`${path} has no x-identifier for password`);
    this.path = path;
  }

  /**
   * The schema, and the method that needs its identifier.
   *
   * @returns Its path, and `password` as the method.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
      method: "password",
    };
  }
}

/**
 * A `$file` reference whose file cannot be read: it is not there, or is not
 * a file.
 */
export class ZitadelConfigReferenceMissingError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Create the referenced file or fix the path.";

  /**
   * The reference, as it was written.
   */
  readonly ref: string;

  /**
   * Make the failure for this reference.
   *
   * @param ref - The reference, as it was written.
   * @param cause - The failure that stopped the read, if one did.
   */
  constructor(ref: string, cause?: unknown) {
    super(`$file ${JSON.stringify(ref)} cannot be read`, cause);
    this.ref = ref;
  }

  /**
   * Nothing beyond the message, which names the reference.
   *
   * @returns No facts.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {};
  }
}

/**
 * A `$file` reference whose file is there but cannot be read for a reason
 * other than permissions.
 */
export class ZitadelConfigReferenceBrokenError extends ZitadelConfigReferenceMissingError {
  override readonly hint: string = "Create the referenced file or fix the path.";
  /**
   * The project-relative path of the file holding the reference.
   */
  readonly path: string;

  /**
   * The operating system's error code, when it gave one.
   */
  readonly errno: string | undefined;

  /**
   * Make the failure for this reference.
   *
   * @param path - The project-relative path of the file holding the reference.
   * @param ref - The reference, as that file wrote it.
   * @param errno - The operating system's error code, when it gave one.
   * @param cause - The failure that stopped the read.
   */
  constructor(path: string, ref: string, errno: string | undefined, cause?: unknown) {
    super(ref, cause);
    this.path = path;
    this.errno = errno;
  }

  /**
   * The file holding the reference, the reference, and the operating system's error code.
   *
   * @returns The file, the reference and, when the system gave one, the code.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
      ref: this.ref,
      ...(this.errno === undefined ? {} : { code: this.errno }),
    };
  }
}

/**
 * A `$file` reference that leads outside the project.
 */
export class ZitadelConfigReferenceOutsideError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string =
    "Keep referenced files inside the project, next to the file that references them; a symlink on the way must resolve inside the project too.";

  /**
   * Make the failure for this reference.
   *
   * @param ref - The reference, as it was written.
   */
  constructor(ref: string) {
    super(`$file ${JSON.stringify(ref)} points outside the project`);
  }
}

/**
 * A file to write or remove that leads outside `.zitadel/`.
 */
export class ZitadelConfigPathOutsideError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string = "Files are only written and removed inside .zitadel/.";

  /**
   * The project-relative path, as it was given.
   */
  readonly path: string;

  /**
   * Make the failure for this path.
   *
   * @param path - The project-relative path, as it was given.
   */
  constructor(path: string) {
    super(`${path} points outside .zitadel/`);
    this.path = path;
  }
}

/**
 * A file to write under a directory that is a file.
 */
export class ZitadelConfigPathBlockedError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;

  /**
   * The project-relative path being written.
   */
  readonly path: string;

  /**
   * The project-relative path of the file where a directory is needed.
   */
  readonly blocker: string;

  /**
   * Make the failure for this path.
   *
   * @param path - The project-relative path being written.
   * @param blocker - The project-relative path of the file where a directory
   *   is needed.
   */
  constructor(path: string, blocker: string) {
    super(`${path} cannot be written (ENOTDIR)`);
    this.path = path;
    this.blocker = blocker;
    this.hint = `Remove ${blocker}, which is a file where a directory is needed, then run the command again.`;
  }

  /**
   * The path, and the file standing where a directory is needed.
   *
   * @returns The path, `ENOTDIR` as the code, and the blocker.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
      code: "ENOTDIR",
      blocker: this.blocker,
    };
  }
}

/**
 * A file to remove that is a directory.
 */
export class ZitadelConfigDirectoryInTheWayError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
  override readonly hint: string;

  /**
   * The project-relative path.
   */
  readonly path: string;

  /**
   * Make the failure for this path.
   *
   * @param path - The project-relative path.
   */
  constructor(path: string) {
    super(`${path} cannot be removed (EISDIR)`);
    this.path = path;
    this.hint = `Remove ${path}, which is a directory where a file is expected, then run the command again.`;
  }

  /**
   * The path a directory stands at.
   *
   * @returns The path, and `EISDIR` as the code.
   */
  override get details(): Readonly<Record<string, unknown>> {
    return {
      file: this.path,
      code: "EISDIR",
    };
  }
}

/**
 * Flow issues in the shape `--json` reports them.
 *
 * @param issues - The issues.
 * @returns Each issue's path, rule, message and, when it has one, step.
 */
function issueDetailsOf(
  issues: readonly FlowIssue[],
): readonly Readonly<Record<string, unknown>>[] {
  return issues.map((item) => {
    if (item.issue.step === undefined) {
      return {
        path: item.path,
        rule: item.issue.rule,
        message: item.issue.message,
      };
    }
    return {
      path: item.path,
      rule: item.issue.rule,
      message: item.issue.message,
      step: item.issue.step,
    };
  });
}

/**
 * The steps that still use a method, in the shape `--json` reports them.
 *
 * @param uses - The steps.
 * @returns Each step with what it keeps, what it is the entry step of and
 *   what leads to it.
 */
function stepDetailsOf(
  uses: readonly FlowMethodUse[],
): readonly Readonly<Record<string, unknown>>[] {
  return uses.map((use) => {
    return {
      path: use.path,
      step: use.step,
      keeps: use.keeps,
      entry_for: use.entryFor,
      targeted_by: use.targetedBy.map((item) => {
        if (item.purpose === undefined) {
          return {
            step: item.step,
            transition: item.transition,
          };
        }
        return {
          step: item.step,
          transition: item.transition,
          purpose: item.purpose,
        };
      }),
    };
  });
}
