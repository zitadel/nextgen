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

import { isCancel, select } from "@clack/prompts";

import { ChooseUseCase } from "@/cli/commands/setup/steps/choose-use-case";
import type { SetupFlags } from "@/cli/commands/setup";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import { ZitadelError } from "@/lib/errors";
import { LocalServer } from "@/lib/local-server/server";
import { rejectionOf } from "@tests/helpers/thrown-value";
import { aQuestionDeps } from "@tests/helpers/setup";

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
 * The step, run for an interactive setup that was given `options`.
 *
 * @param answers - The answers so far.
 * @param options - The flags the command line carried.
 * @param options.flags - The flags the command line carried.
 * @returns The answers the step settled.
 */
async function useCaseFor(
  answers: SetupAnswers,
  options: { flags?: Partial<SetupFlags> } = {},
): Promise<SetupAnswers> {
  return (
    await new ChooseUseCase(aQuestionDeps()).run({
      flags: (options.flags ?? {}) as SetupFlags,
      answers,
    } as Parameters<ChooseUseCase["run"]>[0])
  ).answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("ChooseUseCase", () => {
  it("writes the selected use case into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("business");

    const answers = await useCaseFor(setupAnswers({ useCase: "minimal" }));

    expect(answers.useCase).toBe("business");
  });

  it("preselects the use case already answered", async () => {
    vi.mocked(select).mockResolvedValueOnce("business");

    await useCaseFor(setupAnswers({ useCase: "minimal" }));

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "minimal" });
  });

  it("asks which registration fields to collect, with every field set in its label", async () => {
    vi.mocked(select).mockResolvedValueOnce("minimal");

    await useCaseFor(setupAnswers({ useCase: "minimal" }));

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which fields should registration collect? You can change them later.",
      options: [
        { value: "minimal", label: "Email only" },
        { value: "consumer", label: "Email, first name and last name" },
        { value: "business", label: "Email, first name, last name and company name" },
      ],
    });
  });

  describe("with --use-case", () => {
    it("keeps the flagged use case", async () => {
      const answers = await useCaseFor(setupAnswers({ useCase: "consumer" }), {
        flags: { useCase: "minimal" },
      });

      expect(answers.useCase).toBe("consumer");
    });

    it("does not ask", async () => {
      await useCaseFor(setupAnswers({ useCase: "consumer" }), { flags: { useCase: "minimal" } });

      expect(select).not.toHaveBeenCalled();
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return useCaseFor(setupAnswers({ useCase: "minimal" }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});
