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

import { isCancel, select, text } from "@clack/prompts";

import { ChooseServer } from "@/cli/commands/setup/steps/choose-server";
import type { SetupFlags } from "@/cli/commands/setup";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { Ui } from "@/lib/ui";
import { LocalServer } from "@/lib/local-server/server";
import { aQuestionDeps } from "@tests/helpers/setup";

/**
 * The hosted cloud, the server a run falls back to.
 */
const CLOUD = "https://preview.zitadel.com";

/**
 * A local Zitadel server `zitadel start` ran.
 */
const LOCAL = "http://localhost:8080";

/**
 * The server choice that asks for a URL.
 */
const CUSTOM_SERVER = "__custom__";

/**
 * The app directory setup runs in.
 */
const APP_DIR = "/tmp/app";

/**
 * The boxes the step drew.
 */
const noted = vi.fn<(title: string, lines: readonly string[]) => void>();

/**
 * The lines the step said.
 */
const said = vi.fn<(text: string) => void>();

/**
 * What the step prints through: the boxes and lines it draws are recorded, and the spinner draws
 * nothing.
 */
const UI = {
  note: noted,
  say: said,
  spinner: () => {
    return { message: vi.fn(), stop: vi.fn(), clear: vi.fn() };
  },
} as unknown as Ui;

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
 * @param options - What the run was given.
 * @param options.serverFlag - The `--server` value the command line carried.
 * @returns The answers the step settled.
 */
async function serverFor(
  answers: SetupAnswers,
  options: { serverFlag?: string } = {},
): Promise<SetupAnswers> {
  return (
    await new ChooseServer({
      ...aQuestionDeps(APP_DIR),
      ui: UI,
      serverFlag: options.serverFlag,
    }).run({
      flags: {} as SetupFlags,
      answers,
    } as Parameters<ChooseServer["run"]>[0])
  ).answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("ChooseServer", () => {
  describe("when the cloud is chosen", () => {
    it("writes the cloud", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      const answers = await serverFor(setupAnswers());

      expect(answers.server).toBe(CLOUD);
    });

    it("does not ask for a URL", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await serverFor(setupAnswers());

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when a custom URL is chosen", () => {
    it("writes the URL entered", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      const answers = await serverFor(setupAnswers());

      expect(answers.server).toBe("https://zitadel.internal");
    });

    it("asks for the URL once", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      await serverFor(setupAnswers());

      expect(text).toHaveBeenCalledOnce();
    });
  });

  describe("when a local server is detected", () => {
    beforeEach(() => {
      vi.mocked(LocalServer.detectUrl).mockResolvedValueOnce(LOCAL);
      vi.mocked(select).mockResolvedValueOnce(LOCAL);
    });

    it("looks for it in the app directory", async () => {
      await serverFor(setupAnswers());

      expect(LocalServer.detectUrl).toHaveBeenCalledWith(APP_DIR);
    });

    it("writes it when it is picked", async () => {
      const answers = await serverFor(setupAnswers());

      expect(answers.server).toBe(LOCAL);
    });

    it("does not ask for a URL when it is picked", async () => {
      await serverFor(setupAnswers());

      expect(text).not.toHaveBeenCalled();
    });

    it("preselects it", async () => {
      await serverFor(setupAnswers());

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: LOCAL });
    });

    it("lists it between the cloud and a custom URL", async () => {
      await serverFor(setupAnswers());

      expect(
        vi.mocked(select).mock.calls[0]?.[0].options.map((option) => {
          return option.value;
        }),
      ).toEqual([CLOUD, LOCAL, CUSTOM_SERVER]);
    });

    it("labels it with its URL", async () => {
      await serverFor(setupAnswers());

      expect(vi.mocked(select).mock.calls[0]?.[0].options[1]).toMatchObject({
        label: "Local server (http://localhost:8080)",
      });
    });
  });

  describe("when no local server is detected", () => {
    it("lists the local server as unavailable, and says to start it", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await serverFor(setupAnswers());

      expect(vi.mocked(select).mock.calls[0]?.[0].options).toEqual([
        { value: CLOUD, label: "Zitadel Cloud (preview.zitadel.com)" },
        {
          value: "__local_not_running__",
          label: "Local server",
          hint: "not running — start it first",
          disabled: true,
        },
        { value: CUSTOM_SERVER, label: "Custom URL (self-hosted)" },
      ]);
    });

    it("preselects the cloud", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await serverFor(setupAnswers());

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: CLOUD });
    });
  });

  it("asks which server the app uses, not which one a file points to", async () => {
    vi.mocked(select).mockResolvedValueOnce(CLOUD);

    await serverFor(setupAnswers());

    expect(vi.mocked(select).mock.calls[0]?.[0].message).toBe(
      "Which Zitadel server should your app use?",
    );
  });

  describe("with --server", () => {
    it("keeps the pinned server", async () => {
      const answers = await serverFor(setupAnswers({ server: LOCAL }), { serverFlag: "local" });

      expect(answers).toEqual(setupAnswers({ server: LOCAL }));
    });

    it("does not look for a local server", async () => {
      await serverFor(setupAnswers({ server: LOCAL }), { serverFlag: "local" });

      expect(LocalServer.detectUrl).not.toHaveBeenCalled();
    });

    it("does not ask", async () => {
      await serverFor(setupAnswers({ server: LOCAL }), { serverFlag: "local" });

      expect(select).not.toHaveBeenCalled();
    });
  });
});
