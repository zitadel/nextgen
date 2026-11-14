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
async function signInFor(
  answers: SetupAnswers,
  options: { flags?: Partial<SetupFlags> } = {},
): Promise<SetupAnswers> {
  return (
    await new ChooseSignIn(aQuestionDeps()).run({
      flags: (options.flags ?? {}) as SetupFlags,
      answers,
    } as Parameters<ChooseSignIn["run"]>[0])
  ).answers;
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

    const answers = await signInFor(setupAnswers({ preset: "password-first" }));

    expect(answers.preset).toBe("passkey-first");
  });

  it("preselects the preset already answered", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey-first");

    await signInFor(setupAnswers({ preset: "password-first" }));

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "password-first" });
  });

  it("says what users see first and what is secondary, which both presets enable", async () => {
    vi.mocked(select).mockResolvedValueOnce("password-first");

    await signInFor(setupAnswers({ preset: "password-first" }));

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
      const answers = await signInFor(setupAnswers({ preset: "passkey-first" }), {
        flags: { preset: "passkey-first" },
      });

      expect(answers.preset).toBe("passkey-first");
    });

    it("does not ask", async () => {
      await signInFor(setupAnswers({ preset: "passkey-first" }), {
        flags: { preset: "passkey-first" },
      });

      expect(select).not.toHaveBeenCalled();
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return signInFor(setupAnswers({ preset: "password-first" }));
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});
