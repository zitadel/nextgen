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

// Stub the prober so ServerPrompt tests stay focused on the choice wiring,
// not the actual lsof/fetch discovery (which has its own tests under
// tests/unit/lib/prober/).
vi.mock("../../../../src/lib/prober", () => ({
  listListeningPorts: vi.fn().mockResolvedValue([]),
  probeUrls: vi.fn().mockResolvedValue([]),
}));

import { confirm, isCancel, select, text } from "@clack/prompts";
import { listListeningPorts, probeUrls } from "../../../../src/lib/prober";

import {
  DevPortPrompt,
  FrameworkConfirmPrompt,
  PickFrameworkPrompt,
  ServerPrompt,
  type PromptContext,
  type SetupAnswers,
} from "../../../../src/commands/setup/prompts";

const FRAMEWORK = {
  id: "next",
  appDir: "app" as const,
  devPort: 3000,
  issuerUrl: "http://localhost:3000",
};

function baseAnswers(over: Partial<SetupAnswers> = {}): SetupAnswers {
  return { server: "https://api.zitadel.cloud", devPort: 3000, ...over };
}

const ctx: PromptContext = { framework: FRAMEWORK };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  // Default: nothing listening on localhost. Each ServerPrompt test that
  // exercises the discovery path overrides via mockResolvedValueOnce.
  vi.mocked(listListeningPorts).mockResolvedValue([]);
  vi.mocked(probeUrls).mockResolvedValue([]);
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

  it("offers discovered localhost OIDC servers as additional options", async () => {
    // Two listening ports; the prober finds OIDC discovery docs on both.
    vi.mocked(listListeningPorts).mockResolvedValueOnce([4000, 8080]);
    vi.mocked(probeUrls).mockResolvedValueOnce([
      { url: "http://localhost:4000/.well-known/openid-configuration", value: "http://localhost:4000" },
      { url: "http://localhost:8080/.well-known/openid-configuration", value: "http://localhost:8080" },
    ]);
    vi.mocked(select).mockResolvedValueOnce("http://localhost:4000" as never);

    const out = await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(out.server).toBe("http://localhost:4000");
    // The text prompt must not fire when the user picks a discovered URL.
    expect(text).not.toHaveBeenCalled();

    // Confirm the discovered URLs were injected as select options, between
    // the Cloud row and the "Custom URL" sentinel.
    const opts = selectOptionsFromFirstCall();
    const values = opts.map((option) => option.value);
    expect(values).toEqual([
      "https://api.zitadel.cloud",
      "http://localhost:4000",
      "http://localhost:8080",
      "__custom__",
    ]);
  });

  it("behaves like before when nothing is listening locally", async () => {
    // Default mocks (listListeningPorts → []) already simulate this; assert
    // explicitly that no discovered URLs leak into the options.
    vi.mocked(select).mockResolvedValueOnce("https://api.zitadel.cloud" as never);

    await new ServerPrompt().ask(baseAnswers(), ctx);

    const opts = selectOptionsFromFirstCall();
    const values = opts.map((option) => option.value);
    expect(values).toEqual(["https://api.zitadel.cloud", "__custom__"]);
  });
});

describe("DevPortPrompt", () => {
  it("parses the entered text into a number", async () => {
    vi.mocked(text).mockResolvedValueOnce("4000" as never);

    const out = await new DevPortPrompt().ask(baseAnswers(), ctx);

    expect(out.devPort).toBe(4000);
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
