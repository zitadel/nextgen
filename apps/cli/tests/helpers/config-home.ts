import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

/**
 * Keeps the suite out of the developer's own CLI config directory: every file
 * runs with `XDG_CONFIG_HOME` at an empty directory of its own. A sign-in kept
 * there by `zitadel login` acts in place of a project's stored secret, so one
 * left in the real directory would change what a test connects with, and a
 * test could refresh or overwrite it. A test that stores a sign-in names a
 * directory of its own on top, so none outlives the test.
 */
const configHome = mkdtempSync(join(tmpdir(), "zitadel-config-"));
process.env.XDG_CONFIG_HOME = configHome;

afterAll(() => {
  rmSync(configHome, { recursive: true, force: true });
});
