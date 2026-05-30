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
}));

import { confirm, isCancel, select, text } from "@clack/prompts";

import {
  AuthMethodPrompt,
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
  return { authMethod: undefined, server: "https://api.zitadel.cloud", devPort: 3000, ...over };
}

const ctx: PromptContext = { framework: FRAMEWORK };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
});

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

describe("AuthMethodPrompt", () => {
  it("skips the prompt when answers.authMethod is already set", async () => {
    const out = await new AuthMethodPrompt().ask(baseAnswers({ authMethod: "password" }), ctx);

    expect(out.authMethod).toBe("password");
    expect(select).not.toHaveBeenCalled();
  });

  it("asks and writes the chosen method when undefined", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey" as never);

    const out = await new AuthMethodPrompt().ask(baseAnswers(), ctx);

    expect(out.authMethod).toBe("passkey");
    expect(select).toHaveBeenCalledOnce();
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
