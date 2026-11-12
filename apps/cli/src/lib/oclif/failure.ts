import { stripVTControlCharacters } from "node:util";

import { ux } from "@oclif/core";

import type { ZitadelError } from "@/lib/errors";
import { normalizePublicCliCommands, spellOutCommands } from "@/lib/public-cli";
import { escapeControlCharacters, escapeJsonControlCharacters } from "@/lib/terminal-text";

import type { Summary } from "@/lib/ui";
import { NEXT_LABEL } from "@/lib/ui/summary";

import type { ErrorEnvelope, GlobalOptions, SkippedEnvelope } from "./types";

/**
 * An envelope as the CLI writes it to stdout: pretty-printed, coloured by the
 * theme when stdout is a terminal, and with every control character a value
 * carries spelled out, so what a reader parses is the real text and what a
 * terminal prints is safe.
 *
 * @param json - The envelope.
 * @param theme - The colours oclif paints JSON in.
 * @returns The text to write.
 */
export function envelopeText(json: unknown, theme: Record<string, string> | undefined): string {
  return escapeJsonControlCharacters(ux.colorizeJson(json, { pretty: true, theme }));
}

/**
 * Text as the CLI writes it to stderr. Colour is decided by stdout's terminal,
 * so with only stderr redirected, as in `2> error.log`, the codes are taken
 * back out unless colour was forced.
 *
 * @param text - The text, possibly coloured.
 * @param stderr - Whether stderr is a terminal, and whether colour is forced.
 * @returns The text to write.
 */
export function asideText(
  text: string,
  stderr: Readonly<{ tty: boolean; forced: boolean }>,
): string {
  return stderr.tty || stderr.forced ? text : stripVTControlCharacters(text);
}

/**
 * Adds reported warnings to a skipped or error envelope. Those envelopes carry
 * `warnings` only when there are some, so their shape is otherwise unchanged.
 *
 * @param envelope - The envelope.
 * @param warnings - The warnings the run reported.
 * @returns The envelope, with the warnings when there are any.
 */
export function withWarnings<T extends SkippedEnvelope | ErrorEnvelope>(
  envelope: T,
  warnings: readonly string[],
): T {
  return warnings.length === 0 ? envelope : { ...envelope, warnings: [...warnings] };
}

/** Where a failure happened, as the envelope and the error block name it. */
export type FailureMeta = Pick<GlobalOptions, "cliVersion" | "command" | "source">;

/** A run that failed: what went wrong and where. It knows nothing of how it is shown. */
export class Failure {
  readonly error: ZitadelError;
  readonly meta: FailureMeta;
  readonly warnings: readonly string[];

  /**
   * @param error - What went wrong.
   * @param meta - The command and CLI version it went wrong in.
   * @param warnings - The warnings the run reported before it failed.
   */
  constructor(error: ZitadelError, meta: FailureMeta, warnings: readonly string[] = []) {
    this.error = error;
    this.meta = meta;
    this.warnings = warnings;
  }
}

/** One way of showing a {@link Failure}; the entry point picks one per run. */
export interface FailureOutput {
  /**
   * Shows the failure.
   *
   * @param failure - The failure to show.
   */
  write(failure: Failure): void;
}

/** A failure as the one `--json` error envelope. */
export class JsonFailureOutput implements FailureOutput {
  private readonly emit: (envelope: ErrorEnvelope) => void;

  /**
   * @param emit - Writes an envelope to stdout the way the entry point writes
   *   every envelope.
   */
  constructor(emit: (envelope: ErrorEnvelope) => void) {
    this.emit = emit;
  }

  /**
   * Writes the envelope.
   *
   * @param failure - The failure to write.
   */
  write(failure: Failure): void {
    this.emit(this.envelope(failure));
  }

  /**
   * The failure envelope.
   *
   * @param failure - The failure to describe.
   * @returns The envelope, with the run's warnings when it reported any.
   */
  private envelope(failure: Failure): ErrorEnvelope {
    const { error, meta, warnings } = failure;
    const envelope: ErrorEnvelope = {
      status: "error",
      cli_version: meta.cliVersion,
      command: meta.command,
      source: meta.source,
      code: error.code,
      message: error.message,
      hint: error.hint === undefined ? undefined : spellOutCommands(error.hint, meta.cliVersion),
      next_commands: normalizePublicCliCommands(error.nextCommands, meta.cliVersion),
      details: error.details,
    };
    return withWarnings(envelope, warnings);
  }
}

/** A failure as the summary a person reads on stderr: the CLI's one grammar for a failure. */
export class TerminalFailureOutput implements FailureOutput {
  private readonly draw: (summary: Summary) => void;

  /**
   * @param draw - Draws a summary on stderr the way the entry point draws
   *   everything else there.
   */
  constructor(draw: (summary: Summary) => void) {
    this.draw = draw;
  }

  /**
   * Draws the failure.
   *
   * @param failure - The failure to draw.
   */
  write(failure: Failure): void {
    this.draw(this.summary(failure));
  }

  /**
   * The coded sentence, an optional hint, and any commands to run next. It is
   * the only place a failure becomes words for a person, so there is one
   * grammar however the failure arose.
   *
   * A failure names what it failed on (an origin, an id, a value), so the
   * message and the hint are spelled out here. The envelope keeps them as they
   * came, so a reader parses the real text.
   *
   * @param failure - The failure to describe.
   * @returns The summary.
   */
  private summary(failure: Failure): Summary {
    const { error, meta } = failure;
    const commands = normalizePublicCliCommands(error.nextCommands, meta.cliVersion) ?? [];
    return {
      title: `Error: ${escapeControlCharacters(spellOutCommands(error.message, meta.cliVersion))} (${error.code})`,
      sections: [],
      lines: error.hint
        ? [escapeControlCharacters(spellOutCommands(error.hint, meta.cliVersion))]
        : [],
      ...(commands.length === 0
        ? {}
        : {
            next: [
              {
                text: NEXT_LABEL,
                command: commands.join("\n"),
              },
            ],
            boxed: true,
          }),
      failed: true,
    };
  }
}
