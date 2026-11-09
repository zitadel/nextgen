import type { FlowIssue, FlowMethodUse } from "@/lib/zitadel/flows/checks";

/**
 * What a configuration failure carries beyond its message.
 */
export type ConfigErrorOptions = Readonly<{
  /**
   * What to do about it.
   */
  hint?: string | undefined;
  /**
   * Structured facts about the failure, for a `--json` reader.
   */
  details?: unknown;
}>;

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
  readonly details: unknown;

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
export type FileProblem = Readonly<{
  /**
   * The file's project-relative path.
   */
  path: string;
  /**
   * What is wrong with it.
   */
  problem: string;
}>;

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
    super(
      [
        `${problems.length} configuration ${problems.length === 1 ? "file is" : "files are"} not valid:`,
        ...problems.map((entry) => {
          return `  - ${entry.path}: ${entry.problem}`;
        }),
      ].join("\n"),
      {
        hint: "Fix the files named above, then run the command again; nothing was changed.",
        details: { problems },
      },
    );
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
 * The user schema a change would leave with no way to sign in.
 */
export type NoSignInLeft = Readonly<{
  /**
   * The schema's file.
   */
  path: string;
  /**
   * The schema's name.
   */
  schema: string;
  /**
   * What is being turned off: a method, or a provider.
   */
  disabling: string;
  /**
   * The methods the schema enables before the change.
   */
  usable: readonly string[];
  /**
   * The methods the schema could enable instead.
   */
  alternatives: readonly string[];
}>;

/**
 * A change that turns off the last way to sign in to a user schema.
 *
 * @remarks
 * The server allows it, for a schema whose users are only managed through the
 * API, so the change is made only when the caller asks for it again with
 * `force`.
 */
export class NoSignInLeftError extends ConfigError {
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
 * whichever store it has.
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
      hint: "Move the file aside, or run the command again with --force to replace it.",
      details: { file: path },
    });
    this.path = path;
  }
}

/**
 * What a {@link BrokenFlowsError} reports.
 */
export type BrokenFlows = Readonly<{
  /**
   * The user schema the change edits.
   */
  file: string;
  /**
   * The line the listed issues follow.
   */
  heading: string;
  /**
   * What to do about the issues.
   */
  hint: string;
  /**
   * Every issue, as the server's flow rules word it.
   */
  issues: readonly FlowIssue[];
  /**
   * The steps that use a method being disabled.
   *
   * @remarks
   * Each is listed in place of the issues on it; any other issue is listed as
   * the server's rules word it.
   */
  uses?: readonly FlowMethodUse[] | undefined;
}>;

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
    const uses = input.uses ?? [];
    const unexplained = input.issues.filter(({ path, issue }) => {
      return !uses.some((use) => {
        return use.path === path && use.step === issue.step;
      });
    });
    const lines = [
      ...uses.map(useLine),
      ...unexplained.map(({ path, issue }) => {
        return `${path}: ${issue.message}`;
      }),
    ];
    const issues = input.issues.map(({ path, issue }) => {
      if (issue.step === undefined) {
        return { path, rule: issue.rule, message: issue.message };
      }
      return { path, rule: issue.rule, message: issue.message, step: issue.step };
    });
    const steps = uses.map((use) => {
      return {
        path: use.path,
        step: use.step,
        keeps: use.keeps,
        entry_for: use.entryFor,
        targeted_by: use.targetedBy,
      };
    });
    super(
      [
        input.heading,
        ...lines.map((line) => {
          return `  - ${line}`;
        }),
      ].join("\n"),
      {
        hint: input.hint,
        details:
          input.uses === undefined
            ? { file: input.file, issues }
            : { file: input.file, issues, steps },
      },
    );
  }
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
function useLine(use: FlowMethodUse): string {
  const at = `${use.path}: step ${JSON.stringify(use.step)} ${use.uses}`;
  if (use.keeps.length > 0) {
    return `${at}\n    Still has ${use.keeps.join(", ")}.`;
  }
  const purposes = use.entryFor.map((purpose) => {
    return `purposes.${purpose}`;
  });
  const transitions = use.staying.map(({ step, transition, purpose }) => {
    if (purpose === undefined) {
      return `${step}.${transition}`;
    }
    return `${step}.${transition} (via purposes.${purpose})`;
  });
  const notes = [
    "Left with no field or sign-in method.",
    ...(purposes.length > 0 ? [`Entry step of ${purposes.join(", ")}.`] : []),
    ...(transitions.length > 0 ? [`Targeted by ${transitions.join(", ")}.`] : []),
  ];
  return [at, notes.join(" ")].join("\n    ");
}
