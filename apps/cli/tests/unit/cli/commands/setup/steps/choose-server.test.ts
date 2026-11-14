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
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { PromptContext } from "@/cli/commands/setup/shared";
import { asker } from "@/lib/input";
import { LocalServer } from "@/lib/local-server/server";
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

describe("ChooseServer", () => {
  describe("when the cloud is chosen", () => {
    it("writes the cloud", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      const answers = await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(answers.server).toBe(CLOUD);
    });

    it("does not ask for a URL", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when a custom URL is chosen", () => {
    it("writes the URL entered", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      const answers = await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(answers.server).toBe("https://zitadel.internal");
    });

    it("asks for the URL once", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(text).toHaveBeenCalledOnce();
    });
  });

  describe("when a local server is detected", () => {
    beforeEach(() => {
      vi.mocked(LocalServer.detectUrl).mockResolvedValueOnce(LOCAL);
      vi.mocked(select).mockResolvedValueOnce(LOCAL);
    });

    it("looks for it in the app directory", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(LocalServer.detectUrl).toHaveBeenCalledWith(APP_DIR);
    });

    it("writes it when it is picked", async () => {
      const answers = await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(answers.server).toBe(LOCAL);
    });

    it("does not ask for a URL when it is picked", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });

    it("preselects it", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: LOCAL });
    });

    it("lists it between the cloud and a custom URL", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(
        vi.mocked(select).mock.calls[0]?.[0].options.map((option) => {
          return option.value;
        }),
      ).toEqual([CLOUD, LOCAL, CUSTOM_SERVER]);
    });

    it("labels it with its URL", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0].options[1]).toMatchObject({
        label: "Local server (http://localhost:8080)",
      });
    });
  });

  describe("when no local server is detected", () => {
    it("lists the local server as unavailable, and says to start it", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

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

      await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: CLOUD });
    });
  });

  it("asks which server the app uses, not which one a file points to", async () => {
    vi.mocked(select).mockResolvedValueOnce(CLOUD);

    await new ChooseServer(aPromptDeps()).ask(setupAnswers(), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0].message).toBe(
      "Which Zitadel server should your app use?",
    );
  });

  describe("with --server", () => {
    it("keeps the pinned server", async () => {
      const answers = await new ChooseServer(aPromptDeps()).ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(answers).toEqual(setupAnswers({ server: LOCAL }));
    });

    it("does not look for a local server", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(LocalServer.detectUrl).not.toHaveBeenCalled();
    });

    it("does not ask", async () => {
      await new ChooseServer(aPromptDeps()).ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(select).not.toHaveBeenCalled();
    });
  });
});
