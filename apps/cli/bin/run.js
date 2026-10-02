#!/usr/bin/env node
import { execute } from "@oclif/core";

// Honour `--no-color` / `--color` across both colour paths before any command
// module loads. picocolors inspects argv itself, but consola is gated on the
// environment, so translate the flag to NO_COLOR / FORCE_COLOR here (the
// `@oclif/core` import above does not pull the command modules — those load
// inside `execute()`, after this runs). The env vars, when already set, win.
if (process.argv.includes("--no-color")) process.env.NO_COLOR ||= "1";
else if (process.argv.includes("--color")) process.env.FORCE_COLOR ||= "1";

await execute({ dir: import.meta.url });
