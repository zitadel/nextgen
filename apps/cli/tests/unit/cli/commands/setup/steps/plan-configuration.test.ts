import { describe, expect } from "vitest";

import { PlanConfiguration } from "@/cli/commands/setup/steps/plan-configuration";
import { LocalRuntime } from "@/lib/server";
import { createOrca } from "@/lib/orca";
import { it } from "@tests/fixtures";

type Needs = Parameters<PlanConfiguration["run"]>[0];

/** What the step is given: a Next.js app on port 3000 and a plain local server. */
function aNeed(): Needs {
  return {
    flags: {} as Needs["flags"],
    orca: createOrca(LocalRuntime.DIR),
    app: { framework: "next", devPort: 3000 },
    answers: {
      server: "http://localhost:8080",
      devPort: 3000,
      preset: "password-first",
      useCase: "minimal",
      sso: [],
    },
    scaffoldedFramework: false,
  };
}

describe("PlanConfiguration", () => {
  it.for([
    ["1.2.0", "1.2.0"],
    ["2.0.0-beta.3", "beta"],
  ])(
    "pins the SDK for CLI %s at %s in the patch context",
    async ([cliVersion, expected], { dir }) => {
      const planned = await new PlanConfiguration({
        cliVersion: cliVersion ?? "",
        cwd: dir,
        force: false,
      }).run(aNeed());

      const context = planned.patchContext(
        { id: "next", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
        {
          id: "proj-1",
          name: "demo",
          project_secret: "sk",
          preview_secret: "pk",
          origins: [],
          created_at: "2026-01-01T00:00:00.000Z",
        },
      );

      expect(context.sdkVersion).toBe(expected);
    },
  );
});
