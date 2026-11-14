import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

vi.mock("@/lib/local-server/server", async (importOriginal) => {
  return {
    ...(await importOriginal<object>()),
    LocalServer: { detectUrl: vi.fn(), isPortFree: vi.fn(), nextFreePort: vi.fn() },
  };
});

import { confirm, isCancel } from "@clack/prompts";

import { ConfirmFramework } from "@/cli/commands/setup/steps/confirm-framework";
import type { SetupFlags } from "@/cli/commands/setup";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import { ZitadelError } from "@/lib/errors";
import { LocalServer } from "@/lib/local-server/server";
import { rejectionOf } from "@tests/helpers/thrown-value";
import { aQuestionDeps } from "@tests/helpers/setup";

/**
 * The framework setup detected.
 */
const FRAMEWORK = { id: "next", displayName: "Next.js" };

/**
 * The hosted cloud, the server a run falls back to.
 */
const CLOUD = "https://preview.zitadel.com";

/**
 * What a cancelled prompt answers.
 */
const CANCEL = Symbol("cancel");

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

/**
 * The step, run for an interactive setup of a detected app.
 *
 * @param answers - The answers so far.
 * @param options - What the run was given.
 * @param options.scaffoldedFramework - Whether the developer picked the framework to scaffold.
 * @returns The answers the step settled.
 */
async function confirmationFor(
  answers: SetupAnswers,
  options: { scaffoldedFramework?: boolean } = {},
): Promise<SetupAnswers> {
  return (
    await new ConfirmFramework(aQuestionDeps()).run({
      flags: {} as SetupFlags,
      orca: { displayName: () => FRAMEWORK.displayName },
      app: { framework: FRAMEWORK.id },
      scaffoldedFramework: options.scaffoldedFramework ?? false,
      answers,
    } as unknown as Parameters<ConfirmFramework["run"]>[0])
  ).answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("ConfirmFramework", () => {
  describe("when the developer confirms", () => {
    it("returns the answers unchanged", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const answers = await confirmationFor(setupAnswers());

      expect(answers).toEqual(setupAnswers());
    });

    it("asks whether to set up Zitadel in the detected app", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await confirmationFor(setupAnswers());

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
        message: "Would you like to set up Zitadel in this Next.js app?",
      });
    });
  });

  describe("when the developer already chose the framework", () => {
    it("returns the answers unchanged", async () => {
      const answers = await confirmationFor(setupAnswers(), { scaffoldedFramework: true });

      expect(answers).toEqual(setupAnswers());
    });

    it("does not ask", async () => {
      await confirmationFor(setupAnswers(), { scaffoldedFramework: true });

      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("when the developer declines", () => {
    it("refuses with E_UNSUPPORTED_PROJECT_SHAPE", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return confirmationFor(setupAnswers());
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_UNSUPPORTED_PROJECT_SHAPE" });
    });

    it("says nothing changed and points at the app's own directory, not --framework", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return confirmationFor(setupAnswers());
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        message: "Setup stopped before changing this Next.js app",
        hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
      });
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return confirmationFor(setupAnswers());
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});
