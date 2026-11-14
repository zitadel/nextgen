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

import { PickFrameworkPrompt } from "@/cli/commands/setup/steps/detect-framework";
import { ZitadelError } from "@/lib/errors";
import { asker } from "@/lib/input";
import { LocalServer } from "@/lib/local-server/server";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The framework setup detected.
 */
const FRAMEWORK = { id: "next", displayName: "Next.js" };

/**
 * What a cancelled prompt answers.
 */
const CANCEL = Symbol("cancel");

/**
 * How the wizard asks: interactively, without `--force`.
 */
const ask = asker({ interactive: true, force: false });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("PickFrameworkPrompt", () => {
  it("returns the selected framework id", async () => {
    vi.mocked(select).mockResolvedValueOnce("next");

    const id = await new PickFrameworkPrompt().ask([FRAMEWORK], ask);

    expect(id).toBe("next");
  });

  it("asks which framework to scaffold", async () => {
    vi.mocked(select).mockResolvedValueOnce("next");

    await new PickFrameworkPrompt().ask([FRAMEWORK], ask);

    expect(vi.mocked(select).mock.calls[0]?.[0].message).toBe(
      "Which framework would you like to scaffold?",
    );
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new PickFrameworkPrompt().ask([FRAMEWORK], ask);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});
