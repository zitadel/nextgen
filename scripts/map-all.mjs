import pMap from "p-map";

// Kept apart from dev-process.mjs: that module loads in jobs that run before
// `pnpm install`, which would fail to resolve `p-map`.
// Maps items through an async worker with at most `concurrency` in flight,
// in input order. Every job finishes before a failure is reported (their child
// processes cannot be abandoned safely), and the first failure is rethrown as
// the job's own error, so callers keep printing its message.
export async function mapAll(items, worker, concurrency) {
  try {
    return await pMap(items, worker, { concurrency, stopOnError: false });
  } catch (error) {
    throw error instanceof AggregateError ? error.errors[0] : error;
  }
}
