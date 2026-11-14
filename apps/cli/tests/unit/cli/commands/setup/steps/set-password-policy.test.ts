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

import { SetPasswordPolicy } from "@/cli/commands/setup/steps/set-password-policy";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { PromptContext } from "@/cli/commands/setup/shared";
import { asker } from "@/lib/input";
import { LocalServer } from "@/lib/local-server/server";
import { aSuggest } from "@tests/helpers/suggestions";

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

describe("SetPasswordPolicy", () => {
  it("records the chosen minimum", async () => {
    vi.mocked(select).mockResolvedValueOnce(15);

    const answers = await new SetPasswordPolicy().ask(setupAnswers(), CONTEXT);

    expect(answers.passwordMinLength).toBe(15);
  });

  it("offers 15, 8 or none, with 15 preselected as the recommendation", async () => {
    vi.mocked(select).mockResolvedValueOnce(15);

    await new SetPasswordPolicy().ask(setupAnswers(), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which minimum length should passwords have? You can change it later.",
      initialValue: 15,
      options: [
        { value: 15, label: "15 characters — recommended" },
        { value: 8, label: "8 characters" },
        { value: null, label: "No minimum" },
      ],
    });
  });

  it("records no minimum as none", async () => {
    vi.mocked(select).mockResolvedValueOnce(null);

    const answers = await new SetPasswordPolicy().ask(setupAnswers(), CONTEXT);

    expect(answers.passwordMinLength).toBeNull();
  });

  describe("with --password-min-length", () => {
    it("keeps the flagged minimum", async () => {
      const answers = await new SetPasswordPolicy().ask(setupAnswers({ passwordMinLength: 10 }), {
        ...CONTEXT,
        passwordMinLengthFromFlag: true,
      });

      expect(answers.passwordMinLength).toBe(10);
    });

    it("does not ask", async () => {
      await new SetPasswordPolicy().ask(setupAnswers({ passwordMinLength: 10 }), {
        ...CONTEXT,
        passwordMinLengthFromFlag: true,
      });

      expect(select).not.toHaveBeenCalled();
    });
  });
});
