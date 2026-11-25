import { beforeEach, describe, expect, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { isCancel, select, text } from "@clack/prompts";

import { ChooseServer } from "@/cli/commands/setup/steps/choose-server";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { PromptContext } from "@/cli/commands/setup/shared";
import { ZitadelError } from "@/lib/errors";
import { LocalRuntime } from "@/lib/server";
import { FakeMachine } from "@tests/helpers/local-machine";
import { Asker } from "@/cli/core";
import { it } from "@tests/fixtures";
import { aBinaryRecord } from "@tests/helpers/runtime-record";
import { rejectionOf } from "@tests/helpers/thrown-value";
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
 * The version of the server this CLI ships.
 */
const BUNDLED_VERSION = "1.2.3";

/**
 * A version of the server another CLI release shipped.
 */
const OLDER_VERSION = "1.0.0";

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
const ask = Asker.for({
  interactive: true,
  force: false,
});

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

/**
 * Records, in `dir`, the local server `zitadel start` ran there at {@link LOCAL}.
 *
 * @param dir - The directory start ran in.
 * @param serverVersion - The server version it runs.
 */
async function startedLocally(dir: string, serverVersion: string): Promise<void> {
  await LocalRuntime.write(
    dir,
    aBinaryRecord({ port: 8080, server_url: LOCAL, server_version: serverVersion }),
  );
}

const machine = new FakeMachine({ bundled: BUNDLED_VERSION });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("ChooseServer", () => {
  describe("when the cloud is chosen", () => {
    it("writes the cloud", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      const answers = await new ChooseServer(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        CONTEXT,
      );

      expect(answers.server).toBe(CLOUD);
    });

    it("does not ask for a URL", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when a custom URL is chosen", () => {
    it("writes the URL entered", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      const answers = await new ChooseServer(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        CONTEXT,
      );

      expect(answers.server).toBe("https://zitadel.internal");
    });

    it("writes only the origin of the URL entered, as --server does", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal/console?tab=1");

      const answers = await new ChooseServer(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        CONTEXT,
      );

      expect(answers.server).toBe("https://zitadel.internal");
    });

    it("refuses a URL that is not http(s), as --server does", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("ftp://zitadel.internal");

      const refused = await rejectionOf(() => {
        return new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);
      });

      expect(refused).toBeInstanceOf(ZitadelError);
      expect(refused).toMatchObject({ code: "E_VALIDATION" });
    });

    it("asks for the URL once", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(text).toHaveBeenCalledOnce();
    });
  });

  describe("when a local server is detected", () => {
    const machine = new FakeMachine({ bundled: BUNDLED_VERSION, detected: LOCAL });

    beforeEach(() => {
      vi.mocked(select).mockResolvedValueOnce(LOCAL);
    });

    it("writes it when it is picked", async () => {
      const answers = await new ChooseServer(aPromptDeps(undefined, machine)).ask(
        setupAnswers(),
        CONTEXT,
      );

      expect(answers.server).toBe(LOCAL);
    });

    it("does not ask for a URL when it is picked", async () => {
      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });

    it("preselects it", async () => {
      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: LOCAL });
    });

    it("lists it between the cloud and a custom URL", async () => {
      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(
        vi.mocked(select).mock.calls[0]?.[0].options.map((option) => {
          return option.value;
        }),
      ).toEqual([CLOUD, LOCAL, CUSTOM_SERVER]);
    });

    it("labels it with its URL", async () => {
      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0].options[1]).toMatchObject({
        label: "Local server (http://localhost:8080)",
      });
    });
  });

  describe("when no local server is detected", () => {
    it("lists the local server as unavailable, and says to start it", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

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

      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: CLOUD });
    });
  });

  it("asks which server the app uses, not which one a file points to", async () => {
    vi.mocked(select).mockResolvedValueOnce(CLOUD);

    await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers(), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0].message).toBe(
      "Which Zitadel server should your app use?",
    );
  });

  describe("with --server", () => {
    it("keeps the pinned server", async () => {
      const answers = await new ChooseServer(aPromptDeps(undefined, machine)).ask(
        setupAnswers({ server: LOCAL }),
        {
          ...CONTEXT,
          serverFlag: "local",
        },
      );

      expect(answers).toEqual(setupAnswers({ server: LOCAL }));
    });

    it("does not ask", async () => {
      await new ChooseServer(aPromptDeps(undefined, machine)).ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(select).not.toHaveBeenCalled();
    });
  });

  describe("when the detected local server was started by another CLI release", () => {
    it("lists it as unavailable, and says to restart it", async ({ dir }) => {
      await startedLocally(dir, OLDER_VERSION);
      const machine = new FakeMachine({ bundled: BUNDLED_VERSION, detected: LOCAL });
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ChooseServer(aPromptDeps(dir, machine)).ask(setupAnswers(), {
        ...CONTEXT,
        cwd: dir,
      });

      expect(vi.mocked(select).mock.calls[0]?.[0].options[1]).toEqual({
        value: "__local_outdated__",
        label: "Local server (http://localhost:8080)",
        hint: "runs 1.0.0, this CLI ships 1.2.3 — restart it first",
        disabled: true,
      });
    });

    it("preselects the cloud", async ({ dir }) => {
      await startedLocally(dir, OLDER_VERSION);
      const machine = new FakeMachine({ bundled: BUNDLED_VERSION, detected: LOCAL });
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ChooseServer(aPromptDeps(dir, machine)).ask(setupAnswers(), {
        ...CONTEXT,
        cwd: dir,
      });

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: CLOUD });
    });

    it.for([
      { how: "as start recorded it", url: LOCAL },
      { how: "under its other loopback name", url: "http://127.0.0.1:8080" },
    ])("refuses its URL entered as a custom one, $how", async ({ url }, { dir }) => {
      await startedLocally(dir, OLDER_VERSION);
      const machine = new FakeMachine({ bundled: BUNDLED_VERSION, detected: LOCAL });
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce(url);

      const refused = await rejectionOf(() => {
        return new ChooseServer(aPromptDeps(dir, machine)).ask(setupAnswers(), {
          ...CONTEXT,
          cwd: dir,
        });
      });

      expect(refused).toBeInstanceOf(ZitadelError);
      expect(refused).toMatchObject({
        code: "E_VALIDATION",
        message:
          "That local server runs 1.0.0, but this CLI ships 1.2.3. Restart it first, or enter another URL",
      });
    });
  });

  describe("when the detected local server is this CLI's own release", () => {
    it("offers it", async ({ dir }) => {
      await startedLocally(dir, BUNDLED_VERSION);
      const machine = new FakeMachine({ bundled: BUNDLED_VERSION, detected: LOCAL });
      vi.mocked(select).mockResolvedValueOnce(LOCAL);

      await new ChooseServer(aPromptDeps(dir, machine)).ask(setupAnswers(), {
        ...CONTEXT,
        cwd: dir,
      });

      expect(vi.mocked(select).mock.calls[0]?.[0].options[1]).toMatchObject({ value: LOCAL });
    });
  });
});
