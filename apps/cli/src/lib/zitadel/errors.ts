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
}

/**
 * A change that would make a login flow stop validating.
 */
export class ZitadelConfigFlowBrokenError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}

/**
 * A login flow with errors of its own, so it cannot be checked against a changed schema.
 */
export class ZitadelConfigFlowUncheckedError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
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
}

/**
 * A setting a connection file holds that the platform would not take.
 */
export class ZitadelConfigSettingUnusableError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

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

  /**
   * The project-relative path that is taken.
   */
  readonly path: string;

  /**
   * The slug the file was wanted for.
   */
  readonly wanted: string;

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
    this.wanted = wanted;
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

  /**
   * The project-relative path that is taken.
   */
  readonly path: string;

  /**
   * The slug the file was wanted for.
   */
  readonly wanted: string;

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
    this.wanted = wanted;
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
    this.known = known;
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
    this.candidates = candidates;
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
}

/**
 * A file or directory that cannot be read because the operating system refused
 * to let this process read it.
 */
export class ZitadelConfigFileUnreadableError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "denied";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_AUTH";

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
    super(
      path,
      errno,
      cause,
      `$file ${JSON.stringify(ref)} cannot be read; create the referenced file or fix the path`,
    );
    this.ref = ref;
  }
}

/** A bug in this package: something that cannot happen unless the code is wrong. */
export class ZitadelConfigInternalError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
