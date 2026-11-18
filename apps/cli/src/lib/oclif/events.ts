import { channel } from "node:diagnostics_channel";

import type { GlobalOptions } from "./types";

/**
 * The channel a command announces how its run goes on, for anything that wants
 * to follow a run without the command knowing. Nothing is built when nobody is
 * listening.
 */
export const COMMAND_CHANNEL = "zitadel:command";

/**
 * One fact a command noted about its run: an enum, a boolean, a count or a
 * list of enums, never a value the developer typed.
 */
export type Note = string | number | boolean | readonly string[] | null | undefined;

/**
 * What a command noted about its run so far, by name.
 */
export type Notes = Readonly<Record<string, Note>>;

/**
 * One thing a command's own logic says about its run: what to call it and the
 * facts that go with it.
 */
export type Report = Readonly<{
  name: string;
  facts: Notes;
}>;

/**
 * What every announcement says about the run it is from.
 */
type Run = Readonly<{
  /**
   * What the run is about: the command, the server and how it was invoked.
   */
  meta: GlobalOptions;
  /**
   * A random id that ties one run's announcements together.
   */
  invocationId: string;
  /**
   * When the process began running the command, in milliseconds.
   */
  startedAt: number;
  /**
   * What the command has noted so far.
   */
  notes: Notes;
}>;

/**
 * What a command announces on {@link COMMAND_CHANNEL}.
 */
export type CommandEvent =
  | (Run &
      Readonly<{
        /**
         * The run is known and about to start.
         */
        phase: "opened";
        /**
         * Whether anyone may follow this run at all.
         */
        observed: boolean;
        /**
         * What the command says about how its run is followed, as the command
         * declared it. Opaque here: it is read by whoever follows the run.
         */
        observation: unknown;
        /**
         * What the developer chose for following the run, as typed on the
         * command line, when they chose.
         */
        reporting: boolean | undefined;
        /**
         * Whether a person is at a terminal and was not asked to be left alone.
         */
        interactive: boolean;
      }>)
  | (Run &
      Readonly<{
        /**
         * The command finished with a result.
         */
        phase: "completed";
        /**
         * How it ended: `ok`, `skipped` or `error`.
         */
        status: string;
      }>)
  | (Run &
      Readonly<{
        /**
         * The command failed.
         */
        phase: "failed";
        /**
         * The error code, such as `E_NETWORK`.
         */
        code: string;
        /**
         * The process's exit code.
         */
        exitCode: number;
      }>)
  | Readonly<{
      /**
       * The process is about to end: anything still in flight is pushed to
       * `settle`, which the command waits for.
       */
      phase: "closing";
      invocationId: string;
      settle: Promise<unknown>[];
    }>;

const events = channel(COMMAND_CHANNEL);

/**
 * Announce one event on {@link COMMAND_CHANNEL}, if anybody listens.
 *
 * @param event - The event.
 */
export function announceCommand(event: CommandEvent): void {
  if (events.hasSubscribers) {
    events.publish(event);
  }
}
