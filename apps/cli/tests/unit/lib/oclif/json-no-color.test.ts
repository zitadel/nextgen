import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../../helpers/run-cli";

// An ESC byte in `--json` output means the envelope was ANSI-colorized, which
// breaks `JSON.parse` and `jq` for every consumer. oclif only colorizes JSON
// when a theme is configured and this CLI configures none, so the output is
// plain today — but nothing proves it stays that way. This guard runs the whole
// --json path with colour forced on (FORCE_COLOR), so adding an oclif theme, or
// a stray FORCE_COLOR leaking into a shell, is caught here rather than in a
// user's broken pipeline. `env list` emits a plain envelope with no server, so
// it is the cheapest command to exercise the serialization end to end.
const ESC = "\u001B";

describe("--json output is never ANSI-colorized", () => {
  it("stays valid, colorless JSON even with FORCE_COLOR set", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-json-color-"));

    const res = await runCliForTest(["env", "list", "--cwd", cwd, "--json"], {
      FORCE_COLOR: "1",
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain(ESC);
    // Parses cleanly: an agent reads the envelope regardless of the colour env.
    expect(() => parseJson(res.stdout)).not.toThrow();
  });
});
