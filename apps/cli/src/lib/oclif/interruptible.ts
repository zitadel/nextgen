import type { Command } from "@oclif/core";

import { ZitadelError } from "@/lib/errors";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass = abstract new (...args: any[]) => Command;

/** How long a command may keep running after its first Ctrl-C before it is stopped. */
const GRACE_MS = 1_000;

/**
 * Gives a command a way to be cancelled with Ctrl-C, as an {@link AbortSignal}
 * it hands to whatever waits.
 *
 * Node exits on SIGINT only while nothing listens for it, and a spinner does
 * listen — clack's stops its animation and returns — so a request stalled
 * behind one used to outlive the keypress. A command that listens for itself
 * avoids that: its first Ctrl-C aborts {@link signal} with an `E_CANCELLED`
 * reason, so every request bound to it rejects and the command unwinds through
 * its normal error path.
 *
 * Work that is not bound to the signal does not see it, so the first Ctrl-C
 * also arms a short grace: a command still running when it lapses exits 130. A
 * second Ctrl-C exits at once. A command with its own handler (`logs --follow`
 * stops following) finishes inside the grace and exits as it always did.
 *
 * Only `BaseCommand` is built on this. It starts and stops the listening
 * itself, and everything below it receives the signal as a plain
 * {@link AbortSignal} argument, so no other code needs to know a command can be
 * interrupted. The signal belongs to one run: each command instance has its own.
 *
 * ```ts
 * export abstract class BaseCommand extends Interruptible(Command) {}
 *
 * // in a command
 * const client = createZitadelClient({ baseUrl, token, signal: this.signal });
 * ```
 */
export function Interruptible<TBase extends CommandClass>(Base: TBase) {
  abstract class InterruptibleCommand extends Base {
    private readonly controller = new AbortController();
    private grace: NodeJS.Timeout | undefined;

    /**
     * Aborted once Ctrl-C has been pressed in this run, and stays aborted, so a
     * caller that swallows the first rejection cannot start another request.
     */
    protected get signal(): AbortSignal {
      return this.controller.signal;
    }

    /** Starts listening as the command begins. Calling it again does not add a second listener. */
    protected listenForInterrupt(): void {
      this.stopListeningForInterrupt();
      process.on("SIGINT", this.onInterrupt);
    }

    /**
     * Stops listening as the command ends, and disarms a grace it started, so
     * the timer cannot outlive the command that armed it. That matters when
     * commands share a process, as specs do.
     */
    protected stopListeningForInterrupt(): void {
      process.off("SIGINT", this.onInterrupt);
      clearTimeout(this.grace);
      this.grace = undefined;
    }

    private readonly onInterrupt = (): void => {
      if (this.controller.signal.aborted) {
        process.exit(130);
      }
      this.controller.abort(
        new ZitadelError("E_CANCELLED", "Cancelled", {
          hint: "The command was cancelled with Ctrl-C.",
        }),
      );
      this.grace = setTimeout(() => {
        process.exit(130);
      }, GRACE_MS);
      this.grace.unref();
    };
  }
  return InterruptibleCommand;
}
