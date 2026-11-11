import type { ConsoleAddon } from "./contract";

/**
 * The console's add-on (`./contract.ts`): the empty one, which fills no slot.
 * A build whose `CONSOLE_ADDON` names another compiles that one in place of
 * this module (vite.config.ts), as the hosted cloud's console build does; the
 * console the Go server embeds keeps this one.
 */
export const addon: ConsoleAddon = {};
