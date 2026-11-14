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
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { PromptContext } from "@/cli/commands/setup/shared";
import { ZitadelError } from "@/lib/errors";
import { asker } from "@/lib/input";
import { LocalServer } from "@/lib/local-server/server";
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
 * What a cancelled prompt answers.
 */
const CANCEL = Symbol("cancel");

/**
 * How the wizard asks: interactively, without `--force`.
 */
const ask = asker({ interactive: true, force: false });

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("ChooseUseCase", () => {
  it("writes the selected use case into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("business");

    const answers = await new ChooseUseCase(aPromptDeps()).ask(
      setupAnswers({ useCase: "minimal" }),
      CONTEXT,
    );

    expect(answers.useCase).toBe("business");
  });

  it("preselects the use case already answered", async () => {
    vi.mocked(select).mockResolvedValueOnce("business");

    await new ChooseUseCase(aPromptDeps()).ask(setupAnswers({ useCase: "minimal" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "minimal" });
  });

  it("asks which registration fields to collect, with every field set in its label", async () => {
    vi.mocked(select).mockResolvedValueOnce("minimal");

    await new ChooseUseCase(aPromptDeps()).ask(setupAnswers({ useCase: "minimal" }), CONTEXT);

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
      const answers = await new ChooseUseCase(aPromptDeps()).ask(
        setupAnswers({ useCase: "consumer" }),
        {
          ...CONTEXT,
          useCaseFromFlag: true,
        },
      );

      expect(answers.useCase).toBe("consumer");
    });

    it("does not ask", async () => {
      await new ChooseUseCase(aPromptDeps()).ask(setupAnswers({ useCase: "consumer" }), {
        ...CONTEXT,
        useCaseFromFlag: true,
      });

      expect(select).not.toHaveBeenCalled();
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new ChooseUseCase(aPromptDeps()).ask(setupAnswers({ useCase: "minimal" }), CONTEXT);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});
