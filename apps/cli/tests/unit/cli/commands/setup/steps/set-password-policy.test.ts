import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { isCancel, select } from "@clack/prompts";

import type { SetupFlags } from "@/cli/commands/setup";
import { SetPasswordPolicy } from "@/cli/commands/setup/steps/set-password-policy";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import { aQuestionDeps } from "@tests/helpers/setup";

/**
 * The hosted cloud, the server a run falls back to.
 */
const CLOUD = "https://preview.zitadel.com";

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
 * The step, run for an interactive setup that was given `flags`.
 *
 * @param answers - The answers so far.
 * @param flags - The flags the command line carried.
 * @returns The answers the step settled.
 */
async function passwordPolicyFor(
  answers: SetupAnswers,
  flags: Partial<SetupFlags> = {},
): Promise<SetupAnswers> {
  return (
    await new SetPasswordPolicy(aQuestionDeps()).run({
      flags: flags as SetupFlags,
      answers,
    })
  ).answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("SetPasswordPolicy", () => {
  it("records the chosen minimum", async () => {
    vi.mocked(select).mockResolvedValueOnce(15);

    const answers = await passwordPolicyFor(setupAnswers());

    expect(answers.passwordMinLength).toBe(15);
  });

  it("offers 15, 8 or none, with 15 preselected as the recommendation", async () => {
    vi.mocked(select).mockResolvedValueOnce(15);

    await passwordPolicyFor(setupAnswers());

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

    const answers = await passwordPolicyFor(setupAnswers());

    expect(answers.passwordMinLength).toBeNull();
  });

  describe("with --password-min-length", () => {
    it("keeps the flagged minimum", async () => {
      const answers = await passwordPolicyFor(setupAnswers({ passwordMinLength: 10 }), {
        passwordMinLength: 10,
      });

      expect(answers.passwordMinLength).toBe(10);
    });

    it("does not ask", async () => {
      await passwordPolicyFor(setupAnswers({ passwordMinLength: 10 }), { passwordMinLength: 10 });

      expect(select).not.toHaveBeenCalled();
    });
  });
});
