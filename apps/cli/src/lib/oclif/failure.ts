import type { ZitadelError } from "@/lib/errors";
import { normalizePublicCliCommands, spellOutCommands } from "@/lib/public-cli";
import { escapeControlCharacters } from "@/lib/terminal-text";

import type { Summary } from "@/lib/ui";
import { NEXT_LABEL } from "@/lib/ui/summary";

import type { ErrorEnvelope, GlobalOptions } from "./types";

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
    return warnings.length === 0 ? envelope : { ...envelope, warnings: [...warnings] };
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
