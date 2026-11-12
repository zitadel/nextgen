import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { aMachineThatCannotBeRead, parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { cliPackageRoot } from "@tests/helpers/oclif-build";

describe("stop --all --dry-run", () => {
  it("warns that it cannot look for processes when the machine cannot be read", async ({ dir }) => {
    const result = await runCliForTest(
      ["stop", "--all", "--dry-run", "--json", "--cwd", dir],
      {},
      cliPackageRoot,
      aMachineThatCannotBeRead(),
    );

    expect(parseJson(result.stdout)).toMatchObject({
      status: "ok",
      data: {
        dry_run: true,
        sweep: { supported: false, error: "spawn ps ENOENT" },
      },
      warnings: ["managed-runtime-processes: discovery unavailable"],
    });
  });
});
