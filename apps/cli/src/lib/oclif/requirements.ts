import type { RuleView } from "./rules";
import type { Placeholders, Refusal } from "./refusal";
import type { CommandResult, ConnectOptions, Connection, GlobalOptions } from "./types";

/**
 * What a requirement reads to find what it needs. `connect` opens the project
 * connection of a project command, the one `execute` later shares; any other
 * command has none and it throws.
 */
export type RequirementContext = Readonly<
  RuleView & {
    meta: GlobalOptions;
    connect: (options?: ConnectOptions) => Promise<Connection>;
    resolved: Readonly<Record<string, unknown>>;
  }
>;

/**
 * Something a command needs from outside its own flags, found before the
 * command runs: a server it started earlier, a directory that is a project.
 * `resolve` answers with what it found, or with nothing, and the command is
 * then refused with `refusal` instead of starting; a requirement that always
 * finds something has none. What it found is handed to
 * the command under the name the requirement is declared with.
 *
 * `source` is the server the run is about when what was found says so, which
 * the failure envelope and the result then carry.
 */
export type Requirement<T> = Readonly<{
  refusal?: Refusal;
  resolve: (context: RequirementContext) => Promise<T | Unmet | Ended | undefined>;
  source?(found: T): string;
}>;

/**
 * What a requirement answers with when it found nothing and has worked out
 * values its refusal needs, such as the names it did find.
 */
export type Unmet = Readonly<{
  unmet: Placeholders;
}>;

/** Declares that nothing was found, handing the refusal what was learned. */
export function unmet(values: Placeholders = {}): Unmet {
  return {
    unmet: values,
  };
}

/** Whether a requirement answered with {@link unmet}. */
export function isUnmet(found: unknown): found is Unmet {
  return typeof found === "object" && found !== null && "unmet" in found;
}

/**
 * What a requirement answers with when the run is over before it began, such
 * as a preview with nothing to preview: the command does not execute, and
 * `result` is what it answers with.
 */
export type Ended = Readonly<{
  ended: CommandResult;
}>;

/** Declares that the run ends here with `result`. */
export function ends(result: CommandResult): Ended {
  return {
    ended: result,
  };
}

/** Whether a requirement answered with {@link ends}. */
export function isEnded(found: unknown): found is Ended {
  return typeof found === "object" && found !== null && "ended" in found;
}

/** The requirements a command declares, by the name it receives each under. */
export type Requirements = Readonly<Record<string, Requirement<unknown>>>;

/** What a command's requirements found. */
export type Resolved<R extends Requirements> = {
  readonly [Name in keyof R]: R[Name] extends Requirement<infer T> ? T : never;
};

/** Declares a requirement; the type parameter is what it finds. */
export function requirement<T>(spec: Requirement<T>): Requirement<T> {
  return spec;
}
