import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { CANCEL_SYMBOL, confirm, isCancel } from "@clack/prompts";

import { ConfirmFramework } from "@/cli/commands/setup/steps/confirm-framework";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { PromptContext } from "@/cli/commands/setup/shared";
import { ZitadelError } from "@/lib/errors";
import { Asker } from "@/cli/core";
import { FakeMachine } from "@tests/helpers/local-machine";
import { aSuggest } from "@tests/helpers/suggestions";
import { rejectionOf } from "@tests/helpers/thrown-value";
import { aPromptDeps } from "@tests/helpers/setup";

/**
 * The framework setup detected.
 */
const FRAMEWORK = { id: "next", displayName: "Next.js" };

/**
 * The hosted cloud, the server a run falls back to.
 */
const CLOUD = "https://preview.zitadel.com";

/**
 * The app directory setup runs in.
 */
const APP_DIR = "/tmp/app";

/**
 * How the wizard asks: interactively, without `--force`.
 */
const ask = Asker.for({ interactive: true, force: false });

/**
 * The boxes a prompt drew, as setup's own context would have drawn them.
 */
const noted = vi.fn<(title: string, lines: readonly string[]) => void>();

/**
 * The lines a prompt said, as setup's own context would have said them.
 */
const said = vi.fn<(text: string) => void>();

/**
 * What every prompt is given, as setup builds it: its suggestions are aimed
 * at the project setup creates.
 */
const CONTEXT: PromptContext = {
  ask,
  note: noted,
  say: said,
  spinner: () => {
    return { message: vi.fn(), stop: vi.fn(), clear: vi.fn() };
  },
  framework: FRAMEWORK,
  cwd: APP_DIR,
  suggest: aSuggest({ envFile: ".env.development.local" }, "1.2.3"),
};

/**
 * The answers setup has gathered for a passkey-first, minimal app on the
 * cloud, on port 3000, with no provider.
 *
 * @param overrides - What the answers differ in from the default.
 * @returns The answers.
 */
function setupAnswers(overrides: Partial<SetupAnswers> = {}): SetupAnswers {
  return {
    server: CLOUD,
    devPort: 3000,
    preset: "passkey-first",
    useCase: "minimal",
    sso: [],
    ...overrides,
  };
}

const machine = new FakeMachine();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("ConfirmFramework", () => {
  describe("when the developer confirms", () => {
    it("returns the answers unchanged", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const answers = await new ConfirmFramework(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        CONTEXT,
      );

      expect(answers).toEqual(setupAnswers());
    });

    it("asks whether to set up Zitadel in the detected app", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await new ConfirmFramework(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
        message: "Would you like to set up Zitadel in this Next.js app?",
      });
    });
  });

  describe("when the developer already chose the framework", () => {
    it("returns the answers unchanged", async () => {
      const answers = await new ConfirmFramework(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        {
          ...CONTEXT,
          frameworkChosen: true,
        },
      );

      expect(answers).toEqual(setupAnswers());
    });

    it("does not ask", async () => {
      await new ConfirmFramework(aPromptDeps(undefined, machine)).ask(setupAnswers(), {
        ...CONTEXT,
        frameworkChosen: true,
      });

      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("when the developer declines", () => {
    it("refuses with E_UNSUPPORTED_PROJECT_SHAPE", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return new ConfirmFramework(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_UNSUPPORTED_PROJECT_SHAPE" });
    });

    it("says nothing changed and points at the app's own directory, not --framework", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return new ConfirmFramework(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        message: "Setup stopped before changing this Next.js app",
        hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
      });
    });
  });

  it("aborts with an AbortError on Ctrl-C", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(CANCEL_SYMBOL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new ConfirmFramework(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);
    });
    expect(error).toMatchObject({ name: "AbortError" });
  });
});
