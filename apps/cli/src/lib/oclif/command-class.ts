import type { BaseCommand } from "./base";

/**
 * A class that can be extended, abstract or not, whatever arguments it takes:
 * what a command mixin (`Promptable`, `Destructive`, `Tabulatable`,
 * `ServerCommand`) is given to extend.
 */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
export type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;
