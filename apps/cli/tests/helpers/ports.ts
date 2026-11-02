/**
 * A port from this worker's own block, because a bind-then-close probe races
 * the other vitest workers: a reserved port gets taken as an outbound source
 * port before the CLI binds it.
 *
 * The band sits below every platform's ephemeral range — macOS allocates from
 * 49152 and Linux from 32768 — so a reserved port cannot be taken as an
 * outbound source port by another worker's traffic before the CLI binds it.
 * It also stays clear of the repository's other deferred-bind reservations,
 * 22000-23999 for the journey runner and 24000-31999 for embedded Postgres,
 * which hand out ports before their processes bind just as this does, and of
 * the fixed ports the other suites pin above 18000.
 *
 * Indexed by `VITEST_POOL_ID`, the reusable 1-based pool slot: Vitest gives
 * every file it runs at the same time a different one, from 1 to `maxWorkers`.
 * `VITEST_WORKER_ID` is a unique worker identity that keeps climbing as files
 * spawn workers, so indexing by it walks the block past 65535 and hands the
 * CLI a port that cannot exist.
 *
 * Every slot has a block of its own. Two files in one block both count from
 * its first port, so each hands its tests the ports the other's tests hold,
 * and a start on a held port is refused. Wrapping the slot around ten blocks
 * did exactly that on CI's 16-core runner, where Vitest runs 15 workers:
 * `start` and `status` failed whenever two slots ten apart ran them at once.
 * So `vitest.config.ts` runs at most {@link PORT_WORKERS} workers, and a slot
 * past the last block is refused, not wrapped.
 */
const PORT_FIRST = 16_000;
const PORT_LAST = 18_000;
/**
 * More than twice the 22 ports the hungriest file, `doctor.spec.ts`, takes. A
 * file that takes more wraps around its own block, onto the ports of tests
 * that are over.
 */
const PORT_BLOCK = 50;
/** How many files can take ports at once, a block each: the most workers Vitest may run. */
export const PORT_WORKERS = Math.floor((PORT_LAST - PORT_FIRST) / PORT_BLOCK);
const POOL_SLOT = Math.max(1, Number(process.env.VITEST_POOL_ID ?? 1));
let portOffset = 0;

export function nextPort(): number {
  if (POOL_SLOT > PORT_WORKERS) {
    throw new Error(
      `VITEST_POOL_ID ${POOL_SLOT} has no port block: run at most ${PORT_WORKERS} workers`,
    );
  }
  return PORT_FIRST + (POOL_SLOT - 1) * PORT_BLOCK + (portOffset++ % PORT_BLOCK);
}
