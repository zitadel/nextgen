import type { Command } from "@oclif/core";

/**
 * A class that can be extended, abstract or not, whatever arguments it takes:
 * what a command mixin (`Interruptible`, `Documented`, `Promptable`,
 * `Destructive`, `Tabulatable`, `Wrapped`, `ServerCommand`) is given to extend.
 * A mixin that needs the members of `BaseCommand` names it as `T`.
 */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
export type CommandClass<T extends Command = Command> = abstract new (...args: any[]) => T;
