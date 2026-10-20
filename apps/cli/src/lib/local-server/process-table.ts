export type ProcessRow = Readonly<{
  command: string;
  pid: number;
  ppid?: number;
}>;

/**
 * Where the host's processes come from. Discovery reads them only through
 * this, so a test can hand it a table of its own and never see the machine's.
 * `list` fails when the table cannot be read; `commandOf` returns a process's
 * command line with its environment, or the fallback when that is unavailable.
 */
export interface ProcessTable {
  list(timeoutMs: number): Promise<ReadonlyArray<ProcessRow>>;
  commandOf(pid: number, fallback: string, timeoutMs: number): Promise<string>;
}

declare global {
  // Shared through `globalThis` because the tests that replace the table run
  // the built CLI, a second copy of this module in the same process.
  var __zitadelProcessTable: ProcessTable | undefined;
}

/** The table a test installed, if any. Production never installs one. */
export function installedProcessTable(): ProcessTable | undefined {
  return globalThis.__zitadelProcessTable;
}

/**
 * Replaces the table every discovery reads, or restores the real one when given
 * `undefined`. **Test-only**. This module imports nothing so that a test setup
 * can use it without loading the code that spawns `ps` before a test's mocks.
 */
export function _setProcessTableForTesting(table: ProcessTable | undefined): void {
  globalThis.__zitadelProcessTable = table;
}
