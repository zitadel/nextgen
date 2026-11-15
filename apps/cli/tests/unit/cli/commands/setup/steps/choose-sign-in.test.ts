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

import { ChooseSignIn } from "@/cli/commands/setup/steps/choose-sign-in";
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

describe("ChooseSignIn", () => {
  it("writes the selected preset into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey-first");

    const answers = await new ChooseSignIn(aPromptDeps()).ask(
      setupAnswers({ preset: "password-first" }),
      CONTEXT,
    );

    expect(answers.preset).toBe("passkey-first");
  });

  it("preselects the preset already answered", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey-first");

    await new ChooseSignIn(aPromptDeps()).ask(setupAnswers({ preset: "password-first" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "password-first" });
  });

  it("says what users see first and what is secondary, which both presets enable", async () => {
    vi.mocked(select).mockResolvedValueOnce("password-first");

    await new ChooseSignIn(aPromptDeps()).ask(setupAnswers({ preset: "password-first" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which sign-in method would you like your users to see first?",
      options: [
        {
          value: "password-first",
          label: "Email and password, with passkeys enabled but not shown at sign-in",
        },
        {
          value: "passkey-first",
          label: "Passkey, with email and password shown as the alternative",
        },
      ],
    });
  });

  describe("with --preset", () => {
    it("keeps the flagged preset", async () => {
      const answers = await new ChooseSignIn(aPromptDeps()).ask(
        setupAnswers({ preset: "passkey-first" }),
        {
          ...CONTEXT,
          presetFromFlag: true,
        },
      );

      expect(answers.preset).toBe("passkey-first");
    });

    it("does not ask", async () => {
      await new ChooseSignIn(aPromptDeps()).ask(setupAnswers({ preset: "passkey-first" }), {
        ...CONTEXT,
        presetFromFlag: true,
      });

      expect(select).not.toHaveBeenCalled();
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new ChooseSignIn(aPromptDeps()).ask(
        setupAnswers({ preset: "password-first" }),
        CONTEXT,
      );
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});
