/**
 * The `zitadel` binary entrypoint. Delegates all parsing and dispatch to
 * {@link runCli} and sets `process.exitCode` (rather than calling
 * `process.exit`) so buffered stdout/stderr flush before the process ends.
 */
import { runCli } from "../cli";

const exitCode = await runCli();
process.exitCode = exitCode;
