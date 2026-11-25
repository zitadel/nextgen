import type { ProviderSelection } from "@zitadel/config/idp";

import { ZitadelLibError } from "@/lib/errors";
import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import type { FlowIssue, FlowMethodUse } from "@/lib/zitadel/rules/types";
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
 * Files that are not what their kind of file must be, such as a connection
 * missing its `protocol`.
 *
 * @remarks
 * Every broken file is named at once, so one run lists everything to fix.
 */
export class ZitadelConfigFileBrokenError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure for these files.
   *
   * @param problems - Every broken file, and what is wrong with each.
   */
  constructor(problems: readonly FileProblem[]) {
    const paths = new Set(
      problems.map((entry) => {
        return entry.path;
      }),
    );
    const lines = problems.map((entry) => {
      return `  - ${entry.path}: ${entry.problem}`;
    });
    super(
      [
        `${paths.size} configuration ${new Intl.PluralRules("en").select(paths.size) === "one" ? "file is" : "files are"} not valid:`,
        ...lines,
      ].join("\n"),
    );
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
export class ZitadelConfigSchemaMissingError extends ZitadelConfigError {
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
 * A change a login flow would no longer validate after.
 */
export class ZitadelConfigEditBreaksFlowsError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure for these issues.
   *
   * @param input - The heading and the issues.
   * @param input.heading - The line the listed issues follow.
   * @param input.issues - Every issue, as the server's flow rules word it.
   */
  constructor(input: { readonly heading: string; readonly issues: readonly FlowIssue[] }) {
    const listed = input.issues.map((item) => {
      return `  - ${item.path}: ${item.issue.message}`;
    });
    super([input.heading, ...listed].join("\n"));
  }
}

/**
 * A change that disables a sign-in method login flows still use.
 */
export class ZitadelConfigEditMethodInUseError extends ZitadelConfigError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /**
   * Make the failure for these issues.
   *
   * @param input - The heading, the issues, and the steps that use the method.
   * @param input.heading - The line the listed issues follow.
   * @param input.issues - Every issue, as the server's flow rules word it.
   * @param input.uses - The steps that use the method being disabled.
   */
  constructor(input: {
    readonly heading: string;
    readonly issues: readonly FlowIssue[];
    readonly uses: readonly FlowMethodUse[];
  }) {
    const unexplained = input.issues.filter((item) => {
      return !input.uses.some((use) => {
        return use.path === item.path && use.step === item.issue.step;
      });
    });
    const unexplainedLines = unexplained.map((item) => {
      return `${item.path}: ${item.issue.message}`;
    });
    const lines = [
      ...input.uses.map(ZitadelConfigEditMethodInUseError.useLine),
      ...unexplainedLines,
    ];
    const listed = lines.map((line) => {
      return `  - ${line}`;
    });
    super([input.heading, ...listed].join("\n"));
  }

  /**
   * How a step that uses a method being disabled is listed.
   *
   * @remarks
   * Only a step left with nothing says what starts on it and leads to it, since
   * it is the one to go.
   *
   * @param use - The step.
   * @returns Its line.
   */
  private static useLine(use: FlowMethodUse): string {
    const at = `${use.path}: step ${JSON.stringify(use.step)} ${use.uses}`;
    if (use.keeps.length > 0) {
      return `${at}\n    Still has ${use.keeps.join(", ")}.`;
    }
    const purposes = use.entryFor.map((purpose) => {
      return `purposes.${purpose}`;
    });
    const transitions = use.staying.map((item) => {
      if (item.purpose === undefined) {
        return `${item.step}.${item.transition}`;
      }
      return `${item.step}.${item.transition} (via purposes.${item.purpose})`;
    });
    const entry = `Entry step of ${purposes.join(", ")}.`;
    const targeted = `Targeted by ${transitions.join(", ")}.`;
    const entryNotes = purposes.length > 0 ? [entry] : [];
    const targetedNotes = transitions.length > 0 ? [targeted] : [];
    const notes = ["Left with no field or sign-in method.", ...entryNotes, ...targetedNotes];
    return [at, notes.join(" ")].join("\n    ");
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
