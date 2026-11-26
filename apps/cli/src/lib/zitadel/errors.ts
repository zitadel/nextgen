import type { ProviderSelection } from "@zitadel/config/idp";

import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

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
 * Two things the configuration cannot hold at once, such as two connections
 * with one slug, or a new connection whose file name another one already has.
 */
export class ZitadelConfigResourceClashError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "conflict";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_CONFLICT";
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
}

/** A bug in this package: something that cannot happen unless the code is wrong. */
export class ZitadelConfigInternalError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "fault";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";
}
