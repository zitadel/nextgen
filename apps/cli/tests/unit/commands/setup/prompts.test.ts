import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @clack/prompts so each prompt's clack calls return canned values. Tests
// then drive return values via vi.mocked(...).mockResolvedValueOnce(...).
vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  multiselect: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  note: vi.fn(),
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

import { confirm, isCancel, multiselect, note, password, select, text } from "@clack/prompts";
import { IDP_PROVIDERS, type ProviderSelection } from "@zitadel/config/idp";

import {
  acmeSelection,
  clientId,
  clientSecret,
  googleSelection,
} from "../../../helpers/idp-values";

import { detectHealthyLocalServer } from "../../../../src/lib/local-server/runtime";

import {
  DevPortPrompt,
  FrameworkConfirmPrompt,
  PickFrameworkPrompt,
  ServerPrompt,
  SignInPresetPrompt,
  SETUP_PROMPTS,
  SocialSignInPrompt,
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
  return {
    server: "https://api.zitadel.cloud",
    devPort: 3000,
    preset: "passkey-first",
    useCase: "minimal",
    sso: [],
    ...over,
  };
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
    expect(values).toEqual(["https://api.zitadel.cloud", "http://localhost:8080", "__custom__"]);
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

describe("SETUP_PROMPTS", () => {
  it("asks no login-design question (#1039)", () => {
    // Setup only gets authentication working; taking ownership of the login
    // template is the opt-in `branding eject`, never a wizard step. Social
    // sign-in is not the same kind of question: it configures a way in, which
    // is what setup is for, and it asks last because it is the only one whose
    // answer comes from outside the terminal.
    expect(SETUP_PROMPTS.map((prompt) => prompt.constructor.name)).toEqual([
      "FrameworkConfirmPrompt",
      "ServerPrompt",
      "DevPortPrompt",
      "UseCasePrompt",
      "SignInPresetPrompt",
      "SocialSignInPrompt",
    ]);
  });
});

describe("SocialSignInPrompt", () => {
  it("leaves the answers alone when no provider is wanted", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([] as never);

    const answers = await new SocialSignInPrompt().ask(baseAnswers(), ctx);

    expect(answers.sso).toEqual([]);
    // Nothing is asked for once the developer has declined.
    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
  });

  it("offers every catalog provider and a custom one, with no option meaning none", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([] as never);

    await new SocialSignInPrompt().ask(baseAnswers(), ctx);

    const options = vi.mocked(multiselect).mock.calls[0]?.[0]?.options ?? [];
    // No declining option: an empty selection is the decline, which is what
    // `required: false` on the multiselect allows.
    expect(options.map((option) => option.value)).toEqual([...IDP_PROVIDERS, "custom"]);
  });

  it("captures the credentials and shows the redirect URI to register", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce(["google"] as never);
    vi.mocked(text).mockResolvedValueOnce("  1234-abc.apps.googleusercontent.com  " as never);
    vi.mocked(password).mockResolvedValueOnce("  s3cret  " as never);

    const answers = await new SocialSignInPrompt().ask(baseAnswers({ devPort: 4321 }), ctx);

    expect(answers.sso).toEqual([
      {
        selection: googleSelection,
        credentials: {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "s3cret",
        },
        endpoints: undefined,
      },
    ]);
    // The URI has to be exact — the vendor matches it literally — and the
    // port answered a moment earlier is what decides it.
    expect(vi.mocked(note).mock.calls[0]?.[0]).toContain(
      "http://localhost:4321/__nextgen/idp/callback",
    );
  });

  describe("a custom provider", () => {
    /** The four questions describing the connection, then the client id. */
    function describeAcme(overrides: { slug?: string; scopes?: string } = {}): void {
      vi.mocked(text)
        .mockResolvedValueOnce((overrides.slug ?? " acme-sso ") as never)
        .mockResolvedValueOnce(" Acme SSO " as never)
        .mockResolvedValueOnce(" https://sso.acme.example " as never)
        .mockResolvedValueOnce((overrides.scopes ?? "openid profile email groups") as never)
        .mockResolvedValueOnce("acme-client-id" as never);
    }

    it("is offered beside the catalog, saying what it will ask for", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([] as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      const options = vi.mocked(multiselect).mock.calls[0]?.[0]?.options ?? [];
      expect(options.at(-1)).toMatchObject({
        value: "custom",
        label: "Continue with another OpenID Connect provider",
      });
    });

    it("asks what the connection is, then for its credentials", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      const answers = await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      expect(answers.sso).toEqual([
        {
          selection: {
            kind: "custom",
            connection: {
              slug: "acme-sso",
              displayName: "Acme SSO",
              issuer: "https://sso.acme.example",
              scopes: ["openid", "profile", "email", "groups"],
            },
          },
          credentials: { clientId: "acme-client-id", secret: "acme-secret" },
          endpoints: undefined,
        },
      ]);
    });

    it("names the secret's variable after the connection, not after 'custom'", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      expect(vi.mocked(password).mock.calls.at(-1)?.[0]).toMatchObject({
        message: expect.stringContaining("ACME_SSO_CLIENT_SECRET"),
      });
    });

    it("shows the redirect URI to register at the developer's own provider", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers({ devPort: 4321 }), ctx);

      const [shown, title] = vi.mocked(note).mock.calls[0] ?? [];
      expect(shown).toContain("http://localhost:4321/__nextgen/idp/callback");
      expect(shown).toContain("https://sso.acme.example");
      expect(shown).not.toContain("undefined");
      expect(title).toBe("Acme SSO sign-in");
    });

    it("never asks where the provider lives, even on a development build", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      const answers = await new SocialSignInPrompt().ask(baseAnswers(), {
        ...ctx,
        developmentBuild: true,
      });

      // Slug, display name, issuer, scopes and client id, and nothing more.
      expect(vi.mocked(text)).toHaveBeenCalledTimes(5);
      expect(answers.sso[0]?.endpoints).toBeUndefined();
    });

    it("checks each answer against what the server would refuse", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      const validate = (call: number): ((value: string) => string | undefined) => {
        const options = vi.mocked(text).mock.calls[call]?.[0] as
          | { validate?: (value: string) => string | undefined }
          | undefined;
        return options?.validate ?? (() => "no validator");
      };
      expect(validate(0)("Acme")).toBeTruthy();
      expect(validate(0)("google")).toContain("built-in provider");
      expect(validate(0)("acme-sso")).toBeUndefined();
      expect(validate(1)("  ")).toBeTruthy();
      expect(validate(2)("http://sso.acme.example")).toBeTruthy();
      expect(validate(2)("https://sso.acme.example")).toBeUndefined();
      expect(validate(3)("profile email")).toContain("openid");
      expect(validate(3)("openid email")).toBeUndefined();
    });

    it("will not take an empty client id or client secret, so the connection cannot be left without one", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      type Validate = (value: string) => string | undefined;
      const validatorOf = (call: unknown[] | undefined): Validate => {
        const [options] = call ?? [];
        return (options as { validate: Validate }).validate;
      };
      const clientIdValidate = validatorOf(vi.mocked(text).mock.calls[4]);
      const secretValidate = validatorOf(vi.mocked(password).mock.calls.at(-1));
      for (const validate of [clientIdValidate, secretValidate]) {
        expect(validate("")).toBeTruthy();
        expect(validate("   ")).toBeTruthy();
        expect(validate("something")).toBeUndefined();
      }
    });

    it("uses the description from --sso-* flags rather than asking again", async () => {
      vi.mocked(text).mockResolvedValueOnce("acme-client-id" as never);
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);
      const selection = {
        ...acmeSelection,
        connection: { ...acmeSelection.connection, scopes: ["openid"] },
      } as ProviderSelection;

      const answers = await new SocialSignInPrompt().ask(
        baseAnswers({ sso: [{ selection, credentials: {} }] }),
        { ...ctx, ssoFromFlag: true },
      );

      expect(vi.mocked(text)).toHaveBeenCalledTimes(1);
      expect(answers.sso[0]?.selection).toEqual(selection);
    });
  });

  it("asks where the provider lives on a development build", async () => {
    // Someone working on the CLI runs it against a local stand-in constantly.
    // Before this the connection had to be hand-edited afterwards.
    vi.mocked(multiselect).mockResolvedValueOnce(["google"] as never);
    vi.mocked(text)
      .mockResolvedValueOnce("http://localhost:9100" as never)
      .mockResolvedValueOnce("client-id" as never);
    vi.mocked(password).mockResolvedValueOnce("the-secret" as never);

    const answers = await new SocialSignInPrompt().ask(baseAnswers(), {
      ...ctx,
      developmentBuild: true,
    });

    // Only the issuer: naming a subset of the endpoints the engine needs is
    // rejected as `idp.endpoints_partial`, so discovery supplies them.
    expect(answers.sso[0]?.endpoints).toEqual({ issuer: "http://localhost:9100" });
  });

  it("never asks on a released build", async () => {
    // Gated on the ZITADEL_CLI_DEV opt-in, which a published CLI never sets:
    // someone who installed it is configuring the real vendor and must not
    // meet this question.
    vi.mocked(multiselect).mockResolvedValueOnce(["google"] as never);
    vi.mocked(text).mockResolvedValueOnce("client-id" as never);
    vi.mocked(password).mockResolvedValueOnce("the-secret" as never);

    const answers = await new SocialSignInPrompt().ask(baseAnswers(), {
      ...ctx,
      developmentBuild: false,
    });

    expect(answers.sso[0]?.endpoints).toBeUndefined();
    // Only the client id was asked for, so no URL question was rendered.
    expect(vi.mocked(text)).toHaveBeenCalledTimes(1);
  });

  it("will not take an empty secret, because a provider without one cannot work", async () => {
    // The prompt re-asks rather than accepting nothing: the connection
    // references the secret as `${{ NAME }}` and the engine resolves it from
    // the project's variables, so scaffolding without a value writes a
    // sign-in button that fails at the provider with invalid_client. "Not
    // now" is answered by declining the provider, not by skipping this.
    vi.mocked(multiselect).mockResolvedValueOnce(["google"] as never);
    vi.mocked(text).mockResolvedValueOnce("client-id" as never);
    vi.mocked(password).mockResolvedValueOnce("the-secret" as never);

    await new SocialSignInPrompt().ask(baseAnswers(), ctx);

    const { validate } = vi.mocked(password).mock.calls.at(-1)![0] as {
      validate?: (value: string) => string | undefined;
    };
    expect(validate?.("")).toBeTruthy();
    expect(validate?.("   ")).toBeTruthy();
    expect(validate?.("a-secret")).toBeUndefined();
  });

  it("does not ask which provider when --sso named one", async () => {
    vi.mocked(password).mockResolvedValueOnce("a-secret" as never);
    const seeded = baseAnswers({
      sso: [{ selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } }],
    });

    const answers = await new SocialSignInPrompt().ask(seeded, { ...ctx, ssoFromFlag: true });

    expect(select).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(answers.sso[0]?.selection).toEqual(googleSelection);
    expect(answers.sso[0]?.credentials.clientId).toBe("from-the-flag");
  });

  it("still asks for the secret a flagged run could not supply", async () => {
    // The secret is never a flag, and only a scripted run pipes it in — so an
    // interactive run with --sso arrives here without one.
    vi.mocked(password).mockResolvedValueOnce("typed-after-the-flag" as never);
    const seeded = baseAnswers({
      sso: [{ selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } }],
    });

    const answers = await new SocialSignInPrompt().ask(seeded, { ...ctx, ssoFromFlag: true });

    expect(password).toHaveBeenCalledOnce();
    expect(answers.sso[0]?.credentials.secret).toBe("typed-after-the-flag");
  });

  it("keeps a secret that was already piped in rather than asking again", async () => {
    const seeded = baseAnswers({
      sso: [
        {
          selection: googleSelection,
          credentials: { clientId: clientId("from-the-flag"), secret: clientSecret("piped") },
        },
      ],
    });

    const answers = await new SocialSignInPrompt().ask(seeded, { ...ctx, ssoFromFlag: true });

    expect(password).not.toHaveBeenCalled();
    expect(answers.sso[0]?.credentials.secret).toBe("piped");
  });

  it("throws E_VALIDATION on Ctrl-C at the provider question", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(new SocialSignInPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
