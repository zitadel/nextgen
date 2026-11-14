import { beforeEach, describe, expect, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { isCancel, select } from "@clack/prompts";

import type { SetupFlags } from "@/cli/commands/setup";
import { DetectFramework } from "@/cli/commands/setup/steps/detect-framework";
import { ZitadelError } from "@/lib/errors";
import { asker } from "@/lib/input";
import { Ui } from "@/lib/ui";
import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * What a cancelled prompt answers.
 */
const CANCEL = Symbol("cancel");

/**
 * How the wizard asks and draws: interactively, without `--force`.
 */
const AUDIENCE = { interactive: true, force: false };

/**
 * The step, run in an empty directory, where nothing is detected and a framework
 * has to be chosen.
 *
 * @param cwd - The empty directory.
 * @returns The step's result.
 */
function detectIn(cwd: string) {
  return new DetectFramework({
    ask: asker(AUDIENCE),
    cwd,
    env: {},
    force: false,
    nonInteractive: false,
    serverFlag: undefined,
    ui: new Ui(AUDIENCE),
  }).run({ flags: {} as SetupFlags });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("DetectFramework", () => {
  describe("in an empty directory", () => {
    it("scaffolds the framework that was selected", async ({ dir }) => {
      vi.mocked(select).mockResolvedValueOnce("next");

      const result = await detectIn(dir);

      expect(result.found.app.framework).toBe("next");
    });

    it("asks which framework to scaffold", async ({ dir }) => {
      vi.mocked(select).mockResolvedValueOnce("next");

      await detectIn(dir);

      expect(vi.mocked(select).mock.calls[0]?.[0].message).toBe(
        "Which framework would you like to scaffold?",
      );
    });

    it("refuses with E_CANCELLED on Ctrl-C", async ({ dir }) => {
      vi.mocked(select).mockResolvedValueOnce(CANCEL);
      vi.mocked(isCancel).mockReturnValueOnce(true);

      const error = await rejectionOf(() => {
        return detectIn(dir);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_CANCELLED" });
    });
  });
});
