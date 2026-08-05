import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @clack/prompts so each prompt's clack calls return canned values. Tests
// then drive return values via vi.mocked(...).mockResolvedValueOnce(...).
vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  // `spinner()` returns a tiny stateful handle — the tests don't assert on
  // its frames, just that calling it doesn't break the prompt flow.
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
}));

// Stub local-server detection so ServerPrompt tests stay focused on the
// choice wiring, not the runtime-metadata/health probing (which has its own
// tests under tests/unit/lib/local-server/). Spread the original module so
// unrelated exports (used transitively via lib/server) stay intact.
vi.mock("../../../../src/lib/local-server/runtime", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  detectHealthyLocalServer: vi.fn(),
}));

import { confirm, isCancel, select, text } from "@clack/prompts";
import { detectHealthyLocalServer } from "../../../../src/lib/local-server/runtime";

import {
  DevPortPrompt,
  FrameworkConfirmPrompt,
  PickFrameworkPrompt,
  ServerPrompt,
  SignInPresetPrompt,
  UseCasePrompt,
  type PromptContext,
  type SetupAnswers,
} from "../../../../src/commands/setup/prompts";

const FRAMEWORK = {
  id: "next",
  appDir: "app" as const,
  devPort: 3000,
  url: "http://localhost:3000",
};

function baseAnswers(over: Partial<SetupAnswers> = {}): SetupAnswers {
  return { server: "https://api.zitadel.cloud", devPort: 3000, useCase: "minimal", ...over };
}

const ctx: PromptContext = { framework: FRAMEWORK, cwd: "/tmp/app" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  // Default: no local Zitadel server running. Each ServerPrompt test that
  // exercises the detection path overrides via mockResolvedValueOnce.
  vi.mocked(detectHealthyLocalServer).mockResolvedValue(undefined);
});

/**
 * Reads the `options` array off the first `select(...)` call so we can assert
 * what choices `ServerPrompt` presented. Throws if `select` was never called
 * (rather than returning a misleading empty list).
 */
function selectOptionsFromFirstCall(): ReadonlyArray<{ value: string }> {
  const [firstCall] = vi.mocked(select).mock.calls;
  if (!firstCall) {
    throw new Error("expected `select` to have been called");
  }
  return (firstCall[0] as { options: ReadonlyArray<{ value: string }> }).options;
}

describe("FrameworkConfirmPrompt", () => {
  it("returns answers unchanged when the user confirms", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(true);

    const out = await new FrameworkConfirmPrompt().ask(baseAnswers(), ctx);

    expect(out).toEqual(baseAnswers());
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("next") }),
    );
  });

  it("throws E_UNSUPPORTED_PROJECT_SHAPE when the user declines", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await expect(new FrameworkConfirmPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("throws E_VALIDATION on Ctrl-C", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(new FrameworkConfirmPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});

describe("ServerPrompt", () => {
  it("writes the cloud choice without asking for a URL", async () => {
    vi.mocked(select).mockResolvedValueOnce("https://api.zitadel.cloud" as never);

    const out = await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(out.server).toBe("https://api.zitadel.cloud");
    expect(text).not.toHaveBeenCalled();
  });

  it("follows up with the URL prompt when 'custom' is chosen", async () => {
    vi.mocked(select).mockResolvedValueOnce("__custom__" as never);
    vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal" as never);

    const out = await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(out.server).toBe("https://zitadel.internal");
    expect(text).toHaveBeenCalledOnce();
  });

  it("offers and preselects the detected local Zitadel server", async () => {
    // `zitadel start` ran here: runtime metadata + /healthz say localhost:8080.
    vi.mocked(detectHealthyLocalServer).mockResolvedValueOnce("http://localhost:8080");
    vi.mocked(select).mockResolvedValueOnce("http://localhost:8080" as never);

    const out = await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(detectHealthyLocalServer).toHaveBeenCalledWith(ctx.cwd);
    expect(out.server).toBe("http://localhost:8080");
    // The text prompt must not fire when the user picks the detected server.
    expect(text).not.toHaveBeenCalled();

    // The detected URL sits between the Cloud row and the "Custom URL"
    // sentinel, and is the preselected answer — the user just ran
    // `zitadel start`, so local is almost certainly what they want.
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      initialValue: "http://localhost:8080",
    });
    const values = selectOptionsFromFirstCall().map((option) => option.value);
    expect(values).toEqual([
      "https://api.zitadel.cloud",
      "http://localhost:8080",
      "__custom__",
    ]);
  });

  it("offers only Cloud and Custom when no local server is detected", async () => {
    // Default mock (detectHealthyLocalServer → undefined) already simulates
    // this; assert explicitly that no detected URL leaks into the options.
    vi.mocked(select).mockResolvedValueOnce("https://api.zitadel.cloud" as never);

    await new ServerPrompt().ask(baseAnswers(), ctx);

    const values = selectOptionsFromFirstCall().map((option) => option.value);
    expect(values).toEqual(["https://api.zitadel.cloud", "__custom__"]);
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      initialValue: "https://api.zitadel.cloud",
    });
  });

  it("skips entirely when --server pinned the answer", async () => {
    const answers = baseAnswers({ server: "http://localhost:8080" });

    const out = await new ServerPrompt().ask(answers, {
      ...ctx,
      serverFlag: "local",
    });

    expect(out).toEqual(answers);
    expect(detectHealthyLocalServer).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("DevPortPrompt", () => {
  it("parses the entered text into a number", async () => {
    vi.mocked(text).mockResolvedValueOnce("4000" as never);

    const out = await new DevPortPrompt().ask(baseAnswers(), ctx);

    expect(out.devPort).toBe(4000);
  });

  it("skips and keeps the flagged port when --dev-port was passed", async () => {
    const out = await new DevPortPrompt().ask(baseAnswers({ devPort: 5000 }), {
      ...ctx,
      devPortFromFlag: true,
    });

    expect(out.devPort).toBe(5000);
    expect(vi.mocked(text)).not.toHaveBeenCalled();
  });
});

describe("PickFrameworkPrompt", () => {
  it("returns the selected framework id", async () => {
    vi.mocked(select).mockResolvedValueOnce("next" as never);

    const id = await new PickFrameworkPrompt().ask([{ id: "next", displayName: "Next.js" }]);

    expect(id).toBe("next");
  });

  it("throws E_VALIDATION on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      new PickFrameworkPrompt().ask([{ id: "next", displayName: "Next.js" }]),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});

describe("UseCasePrompt", () => {
  it("writes the selected use case into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("business" as never);

    const answers = await new UseCasePrompt().ask(baseAnswers({ useCase: "minimal" }), ctx);

    expect(answers.useCase).toBe("business");
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "minimal" });
  });

  it("skips and keeps the flagged use case when --use-case was passed", async () => {
    const answers = await new UseCasePrompt().ask(baseAnswers({ useCase: "consumer" }), {
      ...ctx,
      useCaseFromFlag: true,
    });

    expect(answers.useCase).toBe("consumer");
    expect(select).not.toHaveBeenCalled();
  });

  it("throws E_VALIDATION on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      new UseCasePrompt().ask(baseAnswers({ useCase: "minimal" }), ctx),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});

describe("SignInPresetPrompt", () => {
  it("writes the selected preset into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey-first" as never);

    const answers = await new SignInPresetPrompt().ask(
      baseAnswers({ preset: "password-first" }),
      ctx,
    );

    expect(answers.preset).toBe("passkey-first");
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      initialValue: "password-first",
    });
  });

  it("skips and keeps the flagged preset when --preset was passed", async () => {
    const answers = await new SignInPresetPrompt().ask(baseAnswers({ preset: "passkey-first" }), {
      ...ctx,
      presetFromFlag: true,
    });

    expect(answers.preset).toBe("passkey-first");
    expect(select).not.toHaveBeenCalled();
  });

  it("throws E_VALIDATION on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      new SignInPresetPrompt().ask(baseAnswers({ preset: "password-first" }), ctx),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
