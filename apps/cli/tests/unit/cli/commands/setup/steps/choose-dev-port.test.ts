import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { isCancel, text } from "@clack/prompts";

import { ChooseDevPort } from "@/cli/commands/setup/steps/choose-dev-port";
import type { SetupFlags } from "@/cli/commands/setup";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import { FakeMachine } from "@tests/helpers/local-machine";
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
 * @param machine - The machine the run is on, with every port free by default.
 * @returns The answers the step settled.
 */
async function devPortFor(
  answers: SetupAnswers,
  flags: Partial<SetupFlags> = {},
  machine: FakeMachine = new FakeMachine(),
): Promise<SetupAnswers> {
  return (
    await new ChooseDevPort(aQuestionDeps(undefined, machine)).run({
      flags: flags as SetupFlags,
      answers,
    } as Parameters<ChooseDevPort["run"]>[0])
  ).answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("ChooseDevPort", () => {
  describe("when the detected port is free", () => {
    it("keeps the detected port", async () => {
      const answers = await devPortFor(setupAnswers({ devPort: 3000 }));

      expect(answers.devPort).toBe(3000);
    });

    it("does not ask", async () => {
      await devPortFor(setupAnswers({ devPort: 3000 }));

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when the detected port is taken", () => {
    const taken = new FakeMachine({ taken: [3000, 5173] });

    it("parses the entered text into a number", async () => {
      vi.mocked(text).mockResolvedValueOnce("4000");

      const answers = await devPortFor(setupAnswers(), {}, taken);

      expect(answers.devPort).toBe(4000);
    });

    it("says the port is in use and suggests the next free one", async () => {
      vi.mocked(text).mockResolvedValueOnce("5174");

      await devPortFor(setupAnswers({ devPort: 5173 }), {}, taken);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({
        message: "Port 5173 is in use. Which port should your app run on?",
        initialValue: "5174",
      });
    });

    it("suggests the taken port when the next ones are taken too", async () => {
      vi.mocked(text).mockResolvedValueOnce("5173");

      await devPortFor(
        setupAnswers({ devPort: 5173 }),
        {},
        new FakeMachine({
          taken: Array.from({ length: 21 }, (_, index) => {
            return 5173 + index;
          }),
        }),
      );

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({ initialValue: "5173" });
    });
  });

  describe("with --dev-port", () => {
    const taken = new FakeMachine({ taken: [5000] });

    it("keeps the flagged port", async () => {
      const answers = await devPortFor(setupAnswers({ devPort: 5000 }), { devPort: 5000 }, taken);

      expect(answers.devPort).toBe(5000);
    });

    it("does not ask", async () => {
      await devPortFor(setupAnswers({ devPort: 5000 }), { devPort: 5000 }, taken);

      expect(text).not.toHaveBeenCalled();
    });
  });
});
