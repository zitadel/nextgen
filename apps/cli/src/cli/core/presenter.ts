import { ZitadelRuntime } from "@/lib/server";
import { Spelling } from "@/lib/suggestion";
import { Skills } from "@/lib/skills";
import { isObject } from "@/lib/json";
import { Output, style, type Summary, type Ui, warnings } from "@/lib/ui";
import { stripColumnMarks } from "@/lib/ui/layout";
import { textOf } from "@/lib/ui/summary";
import { escapeControlCharacters } from "@/lib/terminal-text";

import { type NextSteps, nextStepsData, renderNextSteps, stepsOf } from "./next-steps";
import { painted } from "@/lib/oclif/rendering";
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
  /**
   * The options the run settled.
   */
  meta: GlobalOptions;
  /**
   * What the run draws with.
   */
  ui: Ui;
  /**
   * The release of the CLI that is running.
   */
  version: string;
  /**
   * Whether the command draws a chain and ends on a summary box.
   */
  wizard: boolean;
  /**
   * Whether the skills offer has not been made yet on this machine.
   */
  skillsOffered: boolean;
  /**
   * Whether the run only plans its changes.
   */
  dryRun: boolean;
  /**
   * Renders a suggested command with the run's own scope.
   */
  suggest: Suggest;
  /**
   * Writes a line to stdout.
   */
  log: (text: string) => void;
  /**
   * Writes a line to stderr.
   */
  logAside: (text: string) => void;
}>;

/**
 * Turns a command's result into what a run writes and the envelope it returns:
 * the one place that knows how a result reaches stdout, stderr and `--json`,
 * so no command, mixin or the base command decides that.
 */
export class Presenter {
  /**
   * The run this presenter writes for.
   */
  private readonly context: PresentedRun;

  /**
   * Builds the presenter of one run.
   *
   * @param context - What the run settled and how it writes.
   */
  constructor(context: PresentedRun) {
    this.context = context;
  }

  /**
   * Writes a result for the reader the run has, and returns its envelope.
   *
   * Output a script reads keeps stdout to itself, so the next steps, the
   * warnings and the footer go beside it on stderr rather than into what the
   * script is reading. The rendering is the CLI's own, painted by it: what the
   * server wrote was spelled out as it entered, so escaping the whole of it
   * here would spell out the colour too. An empty rendering is written as
   * nothing, not as a blank line: a piped list of no records must leave stdout
   * empty, so `wc -l` reports 0. Reported warnings were printed when they
   * happened, so they join the envelope only: printing them again here would
   * show them twice.
   *
   * @param normalized - The result, as {@link normalizeCommandResult} left it.
   * @returns The envelope oclif serialises under `--json`.
   */
  present(normalized: CommandResult): JsonEnvelope {
    const next =
      normalized.status === "ok" && normalized.nextShown !== undefined
        ? ""
        : renderNextSteps(normalized.next ?? {});
    const beside = normalized.status === "ok" && normalized.pretty?.kind === "piped";
    const rendered = renderPretty(normalized, beside ? "" : next, !beside);
    const footer = normalized.status === "ok" ? normalized.footer : undefined;
    const ending = this.endingOf(normalized, footer);
    if (beside) {
      if (rendered !== "") {
        this.context.log(stripColumnMarks(rendered));
      }
      if (next !== "") {
        const bothShareAScreen = rendered !== "" && Output.screen;
        this.context.logAside(bothShareAScreen ? `\n${next}` : next);
      }
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
   *
   * @param result - The result, as it was normalised.
   * @param footer - The line the command printed after everything else, if any.
   * @returns The ending, with its steps, extras and the server it ran on settled.
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
   *
   * @returns The server's host, or `undefined` when it is the default or the run only planned.
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
   *
   * @returns True when what the command rendered is written as it is.
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
   * @returns The summary with its overview and, once, the skills offer.
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

  /**
   * Whether this command ends on a summary box, which only a wizard does.
   *
   * @returns True for a wizard.
   */
  private summarises(): boolean {
    return this.context.wizard;
  }
}

/**
 * Settles the rendering a result is printed with, and rewrites each suggested
 * `zitadel …` command to the public form the reader can run.
 *
 * @param result - What the command returned.
 * @param meta - The options the run settled.
 * @returns The result, with its rendering and its commands settled.
 */
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
 * left as it is. An entity answers the record it stands for through `toJSON`,
 * which spreading it would lose, so that is what is read.
 *
 * @param data - What the command answered.
 * @param title - The headline the terminal draws.
 * @returns The data, with the headline in it when it can hold one.
 */
function withHeadline(data: unknown, title: string): unknown {
  const record = isObject(data) && typeof data.toJSON === "function" ? data.toJSON() : data;

  return isObject(record) && !("title" in record) && title !== ""
    ? {
        title,
        ...record,
      }
    : data;
}

/**
 * The data with its next steps written in. Data that is not an object (a
 * write the server answered without a body) has nowhere to hold them.
 *
 * @param data - What the command answered.
 * @param next - The result's next steps.
 * @returns The data, with the steps in it when it can hold them.
 */
function withNextSteps(data: unknown, next: NextSteps | undefined): unknown {
  return next === undefined || !isObject(data)
    ? data
    : {
        ...data,
        ...nextStepsData(next),
      };
}

/**
 * Adds the warnings reported while the command ran to an ok result.
 *
 * @param result - The result.
 * @param reported - The warnings reported while it ran.
 * @returns The result, with the warnings first among its own.
 */
function withReportedWarnings(result: CommandResult, reported: readonly string[]): CommandResult {
  if (result.status !== "ok" || reported.length === 0) {
    return result;
  }

  return {
    ...result,
    warnings: [...reported, ...(result.warnings ?? [])],
  };
}

/**
 * Add reported warnings to a skipped or error envelope. Those envelopes carry
 * `warnings` only when there are some, so their shape is otherwise unchanged.
 *
 * @param envelope - The envelope.
 * @param warnings - The warnings reported while the command ran.
 * @returns The envelope, with its warnings when there are any.
 */
export function withWarnings<T extends SkippedEnvelope | ErrorEnvelope>(
  envelope: T,
  warnings: readonly string[],
): T {
  return warnings.length === 0
    ? envelope
    : {
        ...envelope,
        warnings: [...warnings],
      };
}

/**
 * Wraps a {@link CommandResult} with the invocation metadata into the final envelope.
 *
 * @param result - The result.
 * @param meta - The options the run settled.
 * @returns The envelope.
 */
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
 * output a script reads. A command's own rendering arrives spelled out,
 * because the factory that made it knew which spelling its shape takes, so
 * interpolating what the server answered is safe wherever a command does it.
 *
 * @param result - The result.
 * @param next - The rendered next-step block.
 * @param withWarnings - Whether the warnings follow the rendering.
 * @returns The text, without empty lines.
 */
function renderPretty(result: CommandResult, next: string, withWarnings: boolean): string {
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

/**
 * The warnings a result still has to show: those its own output did not.
 *
 * @param result - The result.
 * @returns The warnings still to be said.
 */
function warningsOf(result: CommandResult): readonly string[] {
  return result.status === "ok" && !result.warningsShown ? (result.warnings ?? []) : [];
}

/**
 * One warning, as a person reads it: a coloured label and the warning itself.
 *
 * A warning names what the server answered as readily as a rendering does, so
 * it is spelled out here — the one place a warning becomes a line — and only
 * the label is coloured, so there is nothing for the spelling to undo.
 *
 * @param warning - What the warning says.
 * @returns The line a person reads.
 */
function warningLine(warning: string): string {
  return `${style.statusColor.warn("Warning:")} ${escapeControlCharacters(warning)}`;
}

/**
 * The label of the step that points at the command index.
 */
const OVERVIEW = "Explore all commands:";
