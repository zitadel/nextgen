import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { isCancel, text } from "@clack/prompts";

import { ChooseDevPort } from "@/cli/commands/setup/steps/choose-dev-port";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { PromptContext } from "@/cli/commands/setup/shared";
import { Asker } from "@/cli/core";
import { FakeMachine } from "@tests/helpers/local-machine";
import { aSuggest } from "@tests/helpers/suggestions";
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

describe("ChooseDevPort", () => {
  describe("when the detected port is free", () => {
    it("asks about the detected port only when something holds it", async () => {
      vi.mocked(text).mockResolvedValueOnce("3001");

      await new ChooseDevPort(aPromptDeps(undefined, new FakeMachine({ taken: [3000] }))).ask(
        setupAnswers({ devPort: 3000 }),
        CONTEXT,
      );

      expect(text).toHaveBeenCalledTimes(1);
    });

    it("keeps the detected port", async () => {
      const answers = await new ChooseDevPort(aPromptDeps(undefined, machine)).ask(
        setupAnswers({ devPort: 3000 }),
        CONTEXT,
      );

      expect(answers.devPort).toBe(3000);
    });

    it("does not ask", async () => {
      await new ChooseDevPort(aPromptDeps(undefined, machine)).ask(
        setupAnswers({ devPort: 3000 }),
        CONTEXT,
      );

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when the detected port is taken", () => {
    const machine = new FakeMachine({
      taken: [3000, 5173],
      nextFree: (port) => {
        return port + 1;
      },
    });

    it("parses the entered text into a number", async () => {
      vi.mocked(text).mockResolvedValueOnce("4000");

      const answers = await new ChooseDevPort(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        CONTEXT,
      );

      expect(answers.devPort).toBe(4000);
    });

    it("says the port is in use and suggests the next free one", async () => {
      vi.mocked(text).mockResolvedValueOnce("5174");

      await new ChooseDevPort(aPromptDeps(undefined, machine)).ask(
        setupAnswers({ devPort: 5173 }),
        CONTEXT,
      );

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({
        message: "Port 5173 is in use. Which port should your app run on?",
        initialValue: "5174",
      });
    });

    it("suggests the taken port when the next ones are taken too", async () => {
      vi.mocked(text).mockResolvedValueOnce("5173");

      await new ChooseDevPort(
        aPromptDeps(
          undefined,
          new FakeMachine({
            taken: Array.from({ length: 21 }, (_, index) => {
              return 5173 + index;
            }),
          }),
        ),
      ).ask(setupAnswers({ devPort: 5173 }), CONTEXT);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({ initialValue: "5173" });
    });
  });

  describe("with --dev-port", () => {
    const machine = new FakeMachine({ taken: [5000] });

    it("keeps the flagged port", async () => {
      const answers = await new ChooseDevPort(aPromptDeps(undefined, machine)).ask(
        setupAnswers({ devPort: 5000 }),
        {
          ...CONTEXT,
          devPortFromFlag: true,
        },
      );

      expect(answers.devPort).toBe(5000);
    });

    it("does not ask", async () => {
      await new ChooseDevPort(aPromptDeps(undefined, machine)).ask(
        setupAnswers({ devPort: 5000 }),
        {
          ...CONTEXT,
          devPortFromFlag: true,
        },
      );

      expect(text).not.toHaveBeenCalled();
    });
  });
});
