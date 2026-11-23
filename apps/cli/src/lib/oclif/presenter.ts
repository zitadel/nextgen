import { ZitadelRuntime } from "@/lib/server";
import { Spelling } from "@/lib/suggestion";
import { Skills } from "@/lib/skills";
import { isObject } from "@/lib/json";
import { Output, type Presentation, style, type Summary, type Ui, warnings } from "@/lib/ui";
import { stripColumnMarks } from "@/lib/ui/layout";
import { textOf } from "@/lib/ui/summary";
import { escapeControlCharacters } from "@/lib/terminal-text";

import { type NextSteps, nextStepsData, renderNextSteps, stepsOf } from "./next-steps";
import { painted } from "./rendering";
import type { Suggest } from "@/lib/suggestion";
import type {
  CommandResult,
  GlobalOptions,
  JsonEnvelope,
  SkippedEnvelope,
  ErrorEnvelope,
  EnvelopeMeta,
} from "./types";

/**
 * What a {@link Presenter} needs from the run it presents: the settled options,
 * the UI, and the two ways to write. It is handed these rather than reaching
 * into the command, so presenting a result does not depend on how a command
 * is composed.
 */
export type PresentedRun = Readonly<{
  meta: GlobalOptions;
  ui: Ui;
  version: string;
  /** Whether the command draws a chain and ends on a summary box. */
  wizard: boolean;
  /** Whether the skills offer has not been made yet on this machine. */
  skillsOffered: boolean;
  dryRun: boolean;
  suggest: Suggest;
  /** Writes a line to stdout. */
  log: (text: string) => void;
  /** Writes a line to stderr. */
  logAside: (text: string) => void;
}>;

/**
 * Turns a command's result into what a run writes and the envelope it returns:
 * the one place that knows how a result reaches stdout, stderr and `--json`,
 * so no command, mixin or the base command decides that.
 */
export class Presenter {
  private readonly context: PresentedRun;

  constructor(context: PresentedRun) {
    this.context = context;
  }

  /**
   * Writes a result for the reader the run has, and returns its envelope.
   *
   * @param normalized - The result, as {@link normalizeCommandResult} left it.
   * @returns The envelope oclif serialises under `--json`.
   */
  present(normalized: CommandResult): JsonEnvelope {
    const next =
      normalized.status === "ok" && normalized.nextShown !== undefined
        ? ""
        : renderNextSteps(normalized.next ?? {});
    // Output a script reads keeps stdout to itself, so the next steps go
    // beside it on stderr rather than into what the script is reading.
    const beside = normalized.status === "ok" && normalized.pretty?.kind === "piped";
    // The rendering is the CLI's own, painted by it: what the server wrote was
    // spelled out as it entered, so escaping the whole of it here would spell
    // out the colour too.
    // An empty rendering is written as nothing, not as a blank line: a piped
    // list of no records must leave stdout empty, so `wc -l` reports 0.
    const rendered = renderPretty(normalized, beside ? "" : next, !beside);
    const footer = normalized.status === "ok" ? normalized.footer : undefined;
    const ending = this.endingOf(normalized, footer);
    if (beside) {
      if (rendered !== "") {
        this.context.log(stripColumnMarks(rendered));
      }
      if (next !== "") {
        // Set apart from the result only when both share a screen; a piped
        // result is not on screen to be set apart from.
        this.context.logAside(rendered !== "" && Output.screen ? `\n${next}` : next);
      }
      // Only the script's own output stays on stdout; what the CLI adds goes beside it.
      for (const warning of warningsOf(normalized)) {
        this.context.logAside(warningLine(warning));
      }
      if (footer !== undefined) {
        this.context.logAside(`\n${stripColumnMarks(footer)}`);
      }
    } else if (this.context.ui.interactive) {
      this.context.ui.finish(ending);
    } else if (this.rendersForAMachine()) {
      if (rendered !== "") {
        this.context.log(stripColumnMarks(rendered));
      }
      if (footer !== undefined) {
        this.context.log(`\n${stripColumnMarks(footer)}`);
      }
    } else if (!Output.json) {
      const text = this.context.ui.written(ending).replace(/\n+$/, "");
      if (text !== "") {
        this.context.log(text);
      }
    }
    // Reported warnings were printed when they happened, so they join the
    // envelope only: printing them again here would show them twice.
    const reported = warnings.take();
    const envelope = toEnvelope(withReportedWarnings(normalized, reported), this.context.meta);
    return envelope.status === "skipped" ? withWarnings(envelope, reported) : envelope;
  }

  /**
   * How this command ends, as the one {@link Summary} both renderings are
   * built from: the one the command stated. It is settled here rather than per
   * rendering, so a run that is drawn and a run that is written cannot end on
   * different words.
   *
   * The next steps are the result's own, stated once; the ending draws the same
   * ones unless the summary names steps of its own, or the command already
   * showed them in output of its own.
   */
  private endingOf(result: CommandResult, footer: string | undefined): Summary {
    const own = result.summary;
    const steps =
      own.next ??
      (result.status === "ok" && result.nextShown !== undefined ? [] : stepsOf(result.next));
    const ran = own.ran ?? this.serverRanOn();
    const extras = [
      ...(own.extras ?? []),
      ...(footer === undefined ? [] : footer.split("\n")),
      ...(result.status === "ok" && !result.warningsShown
        ? (result.warnings ?? []).map(warningLine)
        : []),
    ];
    return this.withOverview(
      {
        ...own,
        ...(extras.length === 0 ? {} : { extras }),
        ...(steps.length === 0 ? {} : { next: steps }),
        ...(ran === undefined ? {} : { ran }),
      },
      result.status === "ok",
    );
  }

  /**
   * The server this run spoke to, when it is not the default one, so an ending
   * that knows no project can still say where it ran.
   */
  private serverRanOn(): string | undefined {
    if (this.context.dryRun) {
      return undefined;
    }

    return ZitadelRuntime.fromUrl(this.context.meta.source).hostUnlessDefault();
  }

  /**
   * Whether what this command rendered is for a machine rather than a person,
   * in which case it is written as it is and the ending never decorates it.
   *
   * Two things make it so. A command that took its own ending away as text
   * (`setup`, through `Ui.ending`) has already said everything an ending
   * says. And off a terminal a normal command's answer is the machine form it
   * chose for itself — `--plain` is implied there, so a list is tab-separated
   * rows and a record is the record — which `cut`, `awk` and `wc -l` read and
   * which a count or a footer under it would break. A wizard has no such
   * form: what it writes is prose for a person however it is read, so it ends
   * the way it always ends.
   */
  private rendersForAMachine(): boolean {
    return this.context.ui.reported || (!this.summarises() && !Output.screen);
  }

  /**
   * The command overview as the last step of a summary that has steps, so every
   * box ends the same way and the overview can be found from anywhere without
   * already knowing it exists. A summary that names it already keeps its own.
   *
   * @param summary - The ending as the command stated it.
   * @param changed - Whether the run did its work. Only one that did spends the
   * skills offer, which a machine gets once: a skip or a no leaves it for the
   * next run that changes something.
   */
  private withOverview(summary: Summary, changed: boolean): Summary {
    const steps = summary.next ?? [];
    if (!this.summarises()) {
      return {
        ...summary,
        boxed: false,
      };
    }
    const overview = steps.some((step) => {
      return step.text === OVERVIEW;
    })
      ? []
      : [
          {
            text: OVERVIEW,
            command: Spelling.at(this.context.version).command(""),
          },
        ];
    const skills =
      this.context.skillsOffered && changed
        ? [
            new Skills(process.env, !this.context.meta.nonInteractive).claim(
              this.context.suggest({ id: "skills:add" }),
            ),
          ]
        : [];
    return {
      ...summary,
      next: [
        ...steps,
        ...overview,
        ...skills.filter((step) => {
          return step !== undefined;
        }),
      ],
    };
  }

  /** Which of the two shapes this command draws. See {@link BaseCommand.wizard}. */
  private presentation(): Presentation {
    return this.context.wizard ? "wizard" : "plain";
  }

  /** Whether this command ends on a summary box, which only a wizard does. */
  private summarises(): boolean {
    return this.presentation() === "wizard";
  }
}

/** Rewrites each suggested `zitadel …` command to the public form the reader can run. */
export function normalizeCommandResult(result: CommandResult, meta: GlobalOptions): CommandResult {
  const stated =
    result.pretty === undefined && result.summary !== undefined
      ? {
          ...result,
          pretty: painted(textOf(result.summary)),
        }
      : result;
  if (stated.next?.commands === undefined) {
    return stated as CommandResult;
  }

  return {
    ...stated,
    next: {
      ...stated.next,
      commands: Spelling.at(meta.cliVersion).normalizeCommands(stated.next.commands),
    },
  } as CommandResult;
}

/**
 * The data with the headline the terminal draws as its `title`, so a script
 * reads the very words a person does (see {@link CommandResult.summary}).
 * Data that is not an object, or that already has a `title` of its own, is
 * left as it is.
 */
function withHeadline(data: unknown, title: string): unknown {
  // An entity answers the record it stands for through `toJSON`, which spreading it would lose.
  const record = isObject(data) && typeof data.toJSON === "function" ? data.toJSON() : data;

  return isObject(record) && !("title" in record) && title !== "" ? { title, ...record } : data;
}

/**
 * The data with its next steps written in. Data that is not an object (a
 * write the server answered without a body) has nowhere to hold them.
 */
function withNextSteps(data: unknown, next: NextSteps | undefined): unknown {
  return next === undefined || !isObject(data) ? data : { ...data, ...nextStepsData(next) };
}

/** Add the warnings reported while the command ran to an ok result. */
function withReportedWarnings(result: CommandResult, reported: readonly string[]): CommandResult {
  if (result.status !== "ok" || reported.length === 0) {
    return result;
  }

  return { ...result, warnings: [...reported, ...(result.warnings ?? [])] };
}

/**
 * Add reported warnings to a skipped or error envelope. Those envelopes carry
 * `warnings` only when there are some, so their shape is otherwise unchanged.
 */
export function withWarnings<T extends SkippedEnvelope | ErrorEnvelope>(
  envelope: T,
  warnings: readonly string[],
): T {
  return warnings.length === 0 ? envelope : { ...envelope, warnings: [...warnings] };
}

/** Wraps a {@link CommandResult} with the invocation metadata into the final envelope. */
function toEnvelope(result: CommandResult, meta: GlobalOptions): JsonEnvelope {
  const base: EnvelopeMeta = {
    cli_version: meta.cliVersion,
    command: meta.command,
    source: meta.source,
  };
  if (result.status === "ok") {
    return {
      ...base,
      status: "ok",
      data: withNextSteps(
        result.verbatim === true ? result.data : withHeadline(result.data, result.summary.title),
        result.next,
      ),
      warnings: result.warnings ? [...result.warnings] : [],
    };
  }

  return {
    ...base,
    status: "skipped",
    reason: result.reason,
    data: withHeadline(result.data ?? {}, result.summary.title),
    next_commands: result.next?.commands ? [...result.next.commands] : undefined,
  };
}

/**
 * Renders a {@link CommandResult} as human-facing text for non-JSON mode: the
 * command's own rendering, or the one its summary gives (`normalizeCommandResult`
 * settles which). `next` is the rendered next-step block, which follows the
 * rendering, and comes before the warnings, which `withWarnings` leaves out for
 * output a script reads.
 */
function renderPretty(result: CommandResult, next: string, withWarnings: boolean): string {
  // A command's own rendering arrives spelled out, because the factory that
  // made it knew which spelling its shape takes, so interpolating what the
  // server answered is safe wherever a command does it.
  const own = result.pretty?.text ?? "";
  return [
    next === "" || own === "" ? own : `${own.replace(/\n+$/, "")}\n`,
    next,
    ...(withWarnings ? warningsOf(result).map(warningLine) : []),
  ]
    .filter((line) => {
      return line !== "";
    })
    .join("\n");
}

/** The warnings a result still has to show: those its own output did not. */
function warningsOf(result: CommandResult): readonly string[] {
  return result.status === "ok" && !result.warningsShown ? (result.warnings ?? []) : [];
}

/**
 * One warning, as a person reads it: a coloured label and the warning itself.
 *
 * A warning names what the server answered as readily as a rendering does, so
 * it is spelled out here — the one place a warning becomes a line — and only
 * the label is coloured, so there is nothing for the spelling to undo.
 */
export function warningLine(warning: string): string {
  return `${style.statusColor.warn("Warning:")} ${escapeControlCharacters(warning)}`;
}

const OVERVIEW = "Explore all commands:";
