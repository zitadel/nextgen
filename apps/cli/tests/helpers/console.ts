import { Console } from "node:console";

/**
 * Vitest swaps the global console for one that captures output per test, and
 * that one has no `Console` constructor. `ink`, which `@oclif/table` draws a
 * table with, builds its own `console.Console` while it renders, so a table
 * rendered in-process would throw. This gives the captured console the standard
 * constructor and leaves the capture as it is.
 */
if (typeof console.Console !== "function") {
  Object.defineProperty(console, "Console", { value: Console, configurable: true, writable: true });
}
