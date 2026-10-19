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
 * Indexed by `VITEST_POOL_ID`, the reusable 1-based pool slot.
 * `VITEST_WORKER_ID` is a unique worker identity that keeps climbing as files
 * spawn workers, so indexing by it walks the block past 65535 and hands the
 * CLI a port that cannot exist. The modulo bounds it either way.
 */
const PORT_FIRST = 16_000;
const PORT_LAST = 18_000;
const PORT_BLOCK = 200;
const PORT_BLOCKS = Math.floor((PORT_LAST - PORT_FIRST) / PORT_BLOCK);
const POOL_SLOT = Math.max(1, Number(process.env.VITEST_POOL_ID ?? 1));
const PORT_BASE = PORT_FIRST + ((POOL_SLOT - 1) % PORT_BLOCKS) * PORT_BLOCK;
let portOffset = 0;

export function nextPort(): number {
  return PORT_BASE + (portOffset++ % PORT_BLOCK);
}
