import type { ZitadelError } from "@/lib/errors";
import { normalizePublicCliCommands } from "@/lib/public-cli";
import { statusColor } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";

import { renderNextSteps } from "./next-steps";
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
      hint: error.hint,
      next_commands: normalizePublicCliCommands(error.nextCommands, meta.cliVersion),
      details: error.details,
    };
    return warnings.length === 0 ? envelope : { ...envelope, warnings: [...warnings] };
  }
}

/** A failure as the error block a person reads on stderr. */
export class TerminalFailureOutput implements FailureOutput {
  private readonly aside: (text: string) => void;

  /**
   * @param aside - Writes a block to stderr the way the entry point writes
   *   everything else there.
   */
  constructor(aside: (text: string) => void) {
    this.aside = aside;
  }

  /**
   * Writes the block.
   *
   * @param failure - The failure to write.
   */
  write(failure: Failure): void {
    this.aside(this.block(failure));
  }

  /**
   * The coded message, the hint, and the suggested next commands.
   *
   * A failure names what it failed on (an origin, an id, a value), so the
   * message and the hint are spelled out here. Only the label is coloured, so
   * there is nothing for the spelling to undo.
   *
   * @param failure - The failure to describe.
   * @returns The block, without a trailing newline.
   */
  private block(failure: Failure): string {
    const { error, meta } = failure;
    const lines = [
      `${statusColor.fail(`Error ${error.code}:`)} ${escapeControlCharacters(error.message)}`,
    ];
    if (error.hint) {
      lines.push(escapeControlCharacters(error.hint));
    }
    const next = renderNextSteps({
      commands: normalizePublicCliCommands(error.nextCommands, meta.cliVersion),
    });
    if (next !== "") {
      lines.push(next);
    }
    return lines.join("\n");
  }
}
