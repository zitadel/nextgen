import { build } from "tsdown";

import config from "../../tsdown.config";
import { waitForBuiltCli } from "./oclif-build";

/**
 * The integration harness drives the built oclif CLI in-process (oclif
 * discovers commands from `dist/commands`), so the suite is only meaningful
 * against a fresh build. Building once here — before any test file runs, using
 * the package's own tsdown config — keeps `vitest run` self-contained instead
 * of relying on a separate build step.
 */
export default async function setup(): Promise<void> {
  await build(config);
  await waitForBuiltCli();
}
