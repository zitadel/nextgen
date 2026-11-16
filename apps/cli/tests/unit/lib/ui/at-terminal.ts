import { test } from "@tests/fixtures";
import type { TerminalFixture } from "@tests/fixtures/terminal";

/**
 * `it` with the terminal the run is at in every test: stdout and stdin are patched as the
 * `terminal` fixture does it, and given back when the test ends.
 */
export const it = test.extend<{ atTheTerminal: TerminalFixture }>({
  atTheTerminal: [
    async ({ terminal }, use) => {
      await use(terminal);
    },
    { auto: true },
  ],
});
