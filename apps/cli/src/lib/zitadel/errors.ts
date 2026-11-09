import type { ProviderSelection } from "@zitadel/config/idp";

import type { FlowIssue, FlowMethodUse } from "@/lib/zitadel/rules/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * What a configuration failure carries beyond its message.
 */
export type ConfigErrorOptions = {
  /**
   * What to do about it.
   */
  readonly hint?: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details?: JsonObject | undefined;
};

/**
 * Anything `lib/zitadel` fails with.
 *
 * @remarks
 * A caller catches this, or one of its subclasses; the CLI turns it into its
 * own error in one place.
 */
export class ConfigError extends Error {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ConfigError";

  /**
   * What to do about it.
   */
  readonly hint: string | undefined;

  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  readonly details: JsonObject | undefined;

  /**
   * Make a configuration failure.
   *
   * @param message - What went wrong.
   * @param options - What to do about it, and the facts behind it.
   */
  constructor(message: string, options: ConfigErrorOptions = {}) {
    super(message);
    this.hint = options.hint;
    this.details = options.details;
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
 * Files that are not what their kind of file must be, such as a connection
 * missing its `protocol`.
 *
 * @remarks
 * Every broken file is named at once, so one run lists everything to fix.
 */
export class BrokenFilesError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "BrokenFilesError";

  /**
   * Every broken file, and what is wrong with each.
   */
  readonly problems: readonly FileProblem[];

  /**
   * Make the failure for these files.
   *
   * @param problems - Every broken file, and what is wrong with each.
   */
  constructor(problems: readonly FileProblem[]) {
    const files = problems.length === 1 ? "file is" : "files are";
    const lines = problems.map((entry) => {
      return `  - ${entry.path}: ${entry.problem}`;
    });
    super([`${problems.length} configuration ${files} not valid:`, ...lines].join("\n"), {
      hint: "Fix the files named above, then run the command again; nothing was changed.",
      details: { problems },
    });
    this.problems = problems;
  }
}

/**
 * An edit that cannot be made without discarding something written by hand.
 */
export class RefusedEditError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "RefusedEditError";
}

/**
 * Two things the configuration cannot hold at once, such as two connections
 * with one slug, or a new connection whose file name another one already has.
 */
export class ConflictError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ConflictError";
}

/**
 * Something the run named that the configuration does not have.
 */
export class NotFoundError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "NotFoundError";
}

/**
 * The names of some schemas, for a failure's details.
 *
 * @param schemas - The schemas.
 * @returns Each one's name, in order.
 */
function namesOf(schemas: readonly UserSchema[]): readonly string[] {
  return schemas.map((schema) => {
    return schema.name;
  });
}

/**
 * A user schema asked for by a name no schema has, or asked for in a
 * configuration that has none.
 */
export class SchemaNotFoundError extends NotFoundError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "SchemaNotFoundError";

  /**
   * The name asked for, without a `.json` suffix, or `undefined` when none
   * was.
   */
  readonly requested: string | undefined;

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
    super(message, {
      details: {
        requested: requested ?? null,
        known: namesOf(known),
      },
    });
    this.requested = requested;
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
export class AmbiguousSchemaError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "AmbiguousSchemaError";

  /**
   * The name asked for, without a `.json` suffix, or `undefined` when none
   * was.
   */
  readonly requested: string | undefined;

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
    super(message, {
      details: {
        requested: requested ?? null,
        candidates: namesOf(candidates),
      },
    });
    this.requested = requested;
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
export class NoSignInLeftError extends ConfigError implements NoSignInLeft {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "NoSignInLeftError";

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
    super(`${input.path} would have no way to sign in left`, {
      details: { file: input.path, usable: input.usable, alternatives: input.alternatives },
    });
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
 * whichever store it has. The hint names no flag, as not every command that
 * writes a new file has `--force`; a caller that does replace files words
 * its own.
 */
export class FileExistsError extends ConflictError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "FileExistsError";

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
    super(`${path} already exists`, {
      hint: "Move or rename the file that is already there, then run the command again.",
      details: { file: path },
    });
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
export class ConnectionExistsError extends ConflictError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ConnectionExistsError";

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
    super(`${path} already exists`, {
      hint:
        "A connection file is yours to keep, so it is never replaced or removed. " +
        "Remove it to scaffold a fresh one, or keep it and enable the provider to reuse it.",
      details: { file: path },
    });
    this.path = path;
    this.selection = selection;
  }
}

/**
 * A connection that holds its client id as a value, given another one.
 *
 * @remarks
 * Reusing the connection would keep the id it holds, so the one given would
 * silently not apply. A connection that references a variable holds no id to
 * disagree with.
 */
export class ClientIdMismatchError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "ClientIdMismatchError";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection.
   * @param stored - The client id the connection holds.
   * @param supplied - The client id the developer gave.
   */
  constructor(path: string, stored: string, supplied: string) {
    super(`${path} already uses client id ${stored}, not ${supplied}`, {
      hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
      details: {
        file: path,
        stored_client_id: stored,
        supplied_client_id: supplied,
      },
    });
    this.path = path;
  }
}

/**
 * A connection with a slug wanted for an OIDC connection that has no issuer,
 * so it is not an OIDC connection to reuse at all.
 */
export class NotOidcConnectionError extends ConflictError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "NotOidcConnectionError";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * Make the failure for this connection.
   *
   * @param path - The project-relative path of the connection.
   * @param slug - Its slug.
   */
  constructor(path: string, slug: string) {
    super(`${path} is already named ${slug} and is not an OIDC connection`, {
      hint: "Fix the file, or choose another slug, then run the command again.",
      details: { file: path, slug },
    });
    this.path = path;
  }
}

/**
 * A setting a connection holds that the platform would not take as typed,
 * such as a blank display name.
 */
export class UnusableSettingError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "UnusableSettingError";

  /**
   * The project-relative path of the connection.
   */
  readonly path: string;

  /**
   * Make the failure for this setting.
   *
   * @param path - The project-relative path of the connection.
   * @param slug - Its slug.
   * @param what - How the message names the setting, such as "a display name".
   * @param problem - What the platform's parser found wrong with it.
   */
  constructor(path: string, slug: string, what: string, problem: string) {
    super(`${path} holds ${what} that cannot be used: ${problem}`, {
      hint: "Fix it in that file, or choose another slug.",
      details: { file: path, slug },
    });
    this.path = path;
  }
}

/**
 * What every {@link BrokenFlows} report carries.
 */
type BrokenFlowsBase = {
  /**
   * The user schema the change edits.
   */
  readonly file: string;

  /**
   * The line the listed issues follow.
   */
  readonly heading: string;

  /**
   * What to do about the issues.
   */
  readonly hint: string;

  /**
   * Every issue, as the server's flow rules word it.
   */
  readonly issues: readonly FlowIssue[];
};

/**
 * What a {@link BrokenFlowsError} reports: issues a change brings or a flow
 * already has, or a method being disabled that steps still use.
 */
export type BrokenFlows =
  | (BrokenFlowsBase & { readonly kind: "broken" })
  | (BrokenFlowsBase & {
      readonly kind: "method-in-use";

      /**
       * The steps that use the method being disabled.
       *
       * @remarks
       * Each is listed in place of the issues on it; any other issue is listed
       * as the server's rules word it.
       */
      readonly uses: readonly FlowMethodUse[];
    });

/**
 * A change a login flow would no longer validate after, or one that cannot be
 * judged because a flow already fails.
 *
 * @remarks
 * Its details name each issue and, for a method being disabled, each step that
 * still uses it.
 */
export class BrokenFlowsError extends ConfigError {
  /**
   * The class's name, which a log or a stack trace shows.
   */
  override readonly name: string = "BrokenFlowsError";

  /**
   * Make the failure for these issues.
   *
   * @param input - The schema, the heading and hint, the issues, and the steps
   *   that use a method being disabled.
   */
  constructor(input: BrokenFlows) {
    const uses = BrokenFlowsError.usesOf(input);
    const unexplained = input.issues.filter((item) => {
      return !uses.some((use) => {
        return use.path === item.path && use.step === item.issue.step;
      });
    });
    const unexplainedLines = unexplained.map((item) => {
      return `${item.path}: ${item.issue.message}`;
    });
    const lines = [...uses.map(BrokenFlowsError.useLine), ...unexplainedLines];
    const listed = lines.map((line) => {
      return `  - ${line}`;
    });
    const issues = input.issues.map((item): JsonObject => {
      const issue = item.issue;
      if (issue.step === undefined) {
        return { path: item.path, rule: issue.rule, message: issue.message };
      }
      return { path: item.path, rule: issue.rule, message: issue.message, step: issue.step };
    });
    super([input.heading, ...listed].join("\n"), {
      hint: input.hint,
      details: BrokenFlowsError.detailsOf(input, issues),
    });
  }

  /**
   * The steps a report says use a method being disabled.
   *
   * @param input - The report.
   * @returns The steps; none for a report of issues alone.
   */
  private static usesOf(input: BrokenFlows): readonly FlowMethodUse[] {
    if (input.kind === "broken") {
      return [];
    }
    return input.uses;
  }

  /**
   * The details a report carries for a `--json` reader.
   *
   * @param input - The report.
   * @param issues - Its issues, as the details list them.
   * @returns The schema and the issues, and for a method in use, each step.
   */
  private static detailsOf(input: BrokenFlows, issues: readonly JsonObject[]): JsonObject {
    if (input.kind === "broken") {
      return { file: input.file, issues };
    }
    const steps = input.uses.map((use): JsonObject => {
      const targetedBy = use.targetedBy.map((item): JsonObject => {
        if (item.purpose === undefined) {
          return { step: item.step, transition: item.transition };
        }
        return { step: item.step, transition: item.transition, purpose: item.purpose };
      });
      return {
        path: use.path,
        step: use.step,
        keeps: use.keeps,
        entry_for: use.entryFor,
        targeted_by: targetedBy,
      };
    });
    return { file: input.file, issues, steps };
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
