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
  log: { info: vi.fn() },
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
  // `spinner()` returns a tiny stateful handle — the tests don't assert on
  // its frames, just that calling it doesn't break the prompt flow.
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    message: vi.fn(),
  })),
}));

// Stub local-server detection so ServerPrompt tests stay focused on the
// choice wiring, not the runtime-metadata/health probing (which has its own
// tests under tests/unit/lib/local-server/). Spread the original module so
// unrelated exports (used transitively via lib/server) stay intact.
vi.mock("../../../../src/lib/local-server/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  LocalServer: { detectUrl: vi.fn(), isPortFree: vi.fn() },
}));

import { confirm, isCancel, log, multiselect, note, password, select, text } from "@clack/prompts";
import { IDP_PROVIDERS, type ProviderSelection } from "@zitadel/config/idp";

import {
  acmeSelection,
  clientId,
  clientSecret,
  googleSelection,
} from "../../../helpers/idp-values";

import { type Asker, input } from "../../../../src/lib/input";
import { environmentSelectorSuffix } from "../../../../src/lib/oclif/environment-flags";
import { projectCommand } from "../../../../src/lib/suggestion";
import { takeReportedWarnings } from "../../../../src/lib/warnings";
import { LocalServer } from "../../../../src/lib/local-server/server";

import {
  askCustomSettings,
  DevPortPrompt,
  FrameworkConfirmPrompt,
  PasswordPolicyPrompt,
  PickFrameworkPrompt,
  ServerPrompt,
  SignInPresetPrompt,
  SETUP_PROMPTS,
  SocialSignInPrompt,
  UseCasePrompt,
  type PromptContext,
  type SetupAnswers,
} from "../../../../src/commands/setup/prompts";

const FRAMEWORK = { id: "next", displayName: "Next.js" };

function baseAnswers(over: Partial<SetupAnswers> = {}): SetupAnswers {
  return {
    server: "https://preview.zitadel.com",
    devPort: 3000,
    preset: "passkey-first",
    useCase: "minimal",
    sso: [],
    ...over,
  };
}

const ask: Asker = (question) => input(question, { interactive: true, force: false });

const ctx: PromptContext = {
  input: ask,
  framework: FRAMEWORK,
  cwd: "/tmp/app",
  // As setup builds it: aimed at the project setup creates.
  suggest: (args) =>
    projectCommand(args, environmentSelectorSuffix({ envFile: ".env.development.local" }), "1.2.3"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  // Default: no local Zitadel server running. Each ServerPrompt test that
  // exercises the detection path overrides via mockResolvedValueOnce.
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  // Default: the detected app port is free, so the port question stays away.
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
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
      expect.objectContaining({ message: "Set up Zitadel in this Next.js app?" }),
    );
  });

  it("does not ask when the developer already chose the framework", async () => {
    // Picked from the scaffold list a moment earlier, or passed --framework:
    // detection only read their own answer back.
    const out = await new FrameworkConfirmPrompt().ask(baseAnswers(), {
      ...ctx,
      frameworkChosen: true,
    });

    expect(out).toEqual(baseAnswers());
    expect(confirm).not.toHaveBeenCalled();
  });

  it("throws E_UNSUPPORTED_PROJECT_SHAPE when the user declines", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await expect(new FrameworkConfirmPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
    });
  });

  it("says nothing changed and points at the app's own directory, not --framework", async () => {
    // --framework cannot name another framework than the one detected here
    // (setup refuses that with E_CONFLICT), so suggesting it was a dead end.
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await expect(new FrameworkConfirmPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      message: "Setup stopped before changing this Next.js app",
      hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
    });
  });

  it("throws E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(new FrameworkConfirmPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
  });
});

describe("ServerPrompt", () => {
  it("writes the cloud choice without asking for a URL", async () => {
    vi.mocked(select).mockResolvedValueOnce("https://preview.zitadel.com" as never);

    const out = await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(out.server).toBe("https://preview.zitadel.com");
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
    // `zitadel start` ran here: runtime metadata + /readyz say localhost:8080.
    vi.mocked(LocalServer.detectUrl).mockResolvedValueOnce("http://localhost:8080");
    vi.mocked(select).mockResolvedValueOnce("http://localhost:8080" as never);

    const out = await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(LocalServer.detectUrl).toHaveBeenCalledWith(ctx.cwd);
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
    expect(values).toEqual(["https://preview.zitadel.com", "http://localhost:8080", "__custom__"]);
    expect(selectOptionsFromFirstCall()[1]).toMatchObject({
      label: "Local server (http://localhost:8080)",
    });
  });

  it("asks which server the app uses, not which one a file points to", async () => {
    // The developer has not seen zitadel.json yet; the project is created on
    // the server they pick.
    vi.mocked(select).mockResolvedValueOnce("https://preview.zitadel.com" as never);

    await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(vi.mocked(select).mock.calls[0]?.[0]?.message).toBe(
      "Which Zitadel server should your app use?",
    );
  });

  it("lists the local server as unavailable, saying how to start it, when none is detected", async () => {
    vi.mocked(select).mockResolvedValueOnce("https://preview.zitadel.com" as never);

    await new ServerPrompt().ask(baseAnswers(), ctx);

    expect(selectOptionsFromFirstCall()).toEqual([
      { value: "https://preview.zitadel.com", label: "Zitadel Cloud (preview.zitadel.com)" },
      {
        value: "__local_not_running__",
        label: "Local server",
        hint: "not running — run zitadel start first",
        disabled: true,
      },
      { value: "__custom__", label: "Custom URL (self-hosted)" },
    ]);
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      initialValue: "https://preview.zitadel.com",
    });
  });

  it("skips entirely when --server pinned the answer", async () => {
    const answers = baseAnswers({ server: "http://localhost:8080" });

    const out = await new ServerPrompt().ask(answers, {
      ...ctx,
      serverFlag: "local",
    });

    expect(out).toEqual(answers);
    expect(LocalServer.detectUrl).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("DevPortPrompt", () => {
  it("does not ask when the detected port is free", async () => {
    const out = await new DevPortPrompt().ask(baseAnswers({ devPort: 3000 }), ctx);

    expect(LocalServer.isPortFree).toHaveBeenCalledWith(3000);
    expect(out.devPort).toBe(3000);
    expect(vi.mocked(text)).not.toHaveBeenCalled();
  });

  describe("when the detected port is taken", () => {
    beforeEach(() => {
      vi.mocked(LocalServer.isPortFree).mockResolvedValue(false);
    });

    it("parses the entered text into a number", async () => {
      vi.mocked(text).mockResolvedValueOnce("4000" as never);

      const out = await new DevPortPrompt().ask(baseAnswers(), ctx);

      expect(out.devPort).toBe(4000);
    });

    it("says the port is in use and keeps it as the suggestion", async () => {
      // What holds it may be this app's own dev server, and then it is the
      // right answer.
      vi.mocked(text).mockResolvedValueOnce("5173" as never);

      await new DevPortPrompt().ask(baseAnswers({ devPort: 5173 }), ctx);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({
        message: "Port 5173 is in use. Which port should your app run on?",
        initialValue: "5173",
      });
    });
  });

  it("skips and keeps the flagged port when --dev-port was passed", async () => {
    vi.mocked(LocalServer.isPortFree).mockResolvedValue(false);

    const out = await new DevPortPrompt().ask(baseAnswers({ devPort: 5000 }), {
      ...ctx,
      devPortFromFlag: true,
    });

    expect(out.devPort).toBe(5000);
    expect(vi.mocked(text)).not.toHaveBeenCalled();
  });
});

describe("PasswordPolicyPrompt", () => {
  it("offers 15, 8 or none, with 15 preselected as the recommendation", async () => {
    vi.mocked(select).mockResolvedValueOnce(15 as never);

    const out = await new PasswordPolicyPrompt().ask(baseAnswers(), ctx);

    expect(out.passwordMinLength).toBe(15);
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which minimum length should passwords have? You can change it later.",
      initialValue: 15,
      options: [
        { value: 15, label: "15 characters (recommended)" },
        { value: 8, label: "8 characters" },
        { value: null, label: "No minimum" },
      ],
    });
  });

  it("records no minimum as none", async () => {
    vi.mocked(select).mockResolvedValueOnce(null as never);

    const out = await new PasswordPolicyPrompt().ask(baseAnswers(), ctx);

    expect(out.passwordMinLength).toBeNull();
  });

  it("skips and keeps the flagged minimum when --password-min-length was passed", async () => {
    const out = await new PasswordPolicyPrompt().ask(baseAnswers({ passwordMinLength: 10 }), {
      ...ctx,
      passwordMinLengthFromFlag: true,
    });

    expect(out.passwordMinLength).toBe(10);
    expect(vi.mocked(select)).not.toHaveBeenCalled();
  });
});

describe("PickFrameworkPrompt", () => {
  it("returns the selected framework id", async () => {
    vi.mocked(select).mockResolvedValueOnce("next" as never);

    const id = await new PickFrameworkPrompt().ask([{ id: "next", displayName: "Next.js" }], ask);

    expect(id).toBe("next");
  });

  it("throws E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      new PickFrameworkPrompt().ask([{ id: "next", displayName: "Next.js" }], ask),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("UseCasePrompt", () => {
  it("writes the selected use case into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("business" as never);

    const answers = await new UseCasePrompt().ask(baseAnswers({ useCase: "minimal" }), ctx);

    expect(answers.useCase).toBe("business");
    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "minimal" });
  });

  it("asks which registration fields to collect, with every field set in its label", async () => {
    vi.mocked(select).mockResolvedValueOnce("minimal" as never);

    await new UseCasePrompt().ask(baseAnswers({ useCase: "minimal" }), ctx);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which fields should registration collect? You can change them later.",
      options: [
        { value: "minimal", label: "Email only" },
        { value: "consumer", label: "Email, first name and last name" },
        { value: "business", label: "Email, first name, last name and company name" },
      ],
    });
  });

  it("skips and keeps the flagged use case when --use-case was passed", async () => {
    const answers = await new UseCasePrompt().ask(baseAnswers({ useCase: "consumer" }), {
      ...ctx,
      useCaseFromFlag: true,
    });

    expect(answers.useCase).toBe("consumer");
    expect(select).not.toHaveBeenCalled();
  });

  it("throws E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      new UseCasePrompt().ask(baseAnswers({ useCase: "minimal" }), ctx),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
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

  it("names the method offered first and the other one, which both presets enable", async () => {
    vi.mocked(select).mockResolvedValueOnce("password-first" as never);

    await new SignInPresetPrompt().ask(baseAnswers({ preset: "password-first" }), ctx);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which sign-in method should your app offer first?",
      options: [
        { value: "password-first", label: "Email and password, with passkeys also available" },
        { value: "passkey-first", label: "Passkey, with email and password as the fallback" },
      ],
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

  it("throws E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(
      new SignInPresetPrompt().ask(baseAnswers({ preset: "password-first" }), ctx),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
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
      "PasswordPolicyPrompt",
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

  it("says the providers are optional and that Enter skips them", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([] as never);

    await new SocialSignInPrompt().ask(baseAnswers(), ctx);

    const question = vi.mocked(multiselect).mock.calls[0]?.[0];
    expect(question?.message).toBe(
      "Add external sign-in providers? Optional: press Enter to skip.",
    );
    expect(question?.options.map((option) => option.label)).toEqual([
      "Google — requires a Google OAuth app",
      "Another OpenID Connect (OIDC) provider — requires provider configuration",
    ]);
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
      "http://localhost:4321/__nextgen/idp/google/callback",
    );
  });

  it("drops a provider whose client id is left empty, and says how to add it later", async () => {
    // The redirect URI shows only once Google is ticked; a developer who then
    // finds they have no OAuth application yet should not have to cancel setup.
    vi.mocked(multiselect).mockResolvedValueOnce(["google"] as never);
    vi.mocked(text).mockResolvedValueOnce("   " as never);

    const answers = await new SocialSignInPrompt().ask(baseAnswers(), ctx);

    expect(answers.sso).toEqual([]);
    expect(password).not.toHaveBeenCalled();
    expect(vi.mocked(text).mock.calls[0]?.[0]?.message).toBe(
      "Client ID (Google), or leave empty to add it later",
    );
    expect(log.info).toHaveBeenCalledWith(
      [
        "Skipped Google. Once its OAuth application exists, add it with:",
        "npx @zitadel/cli@1.2.3 auth-method sso enable --provider google --env-file .env.development.local",
      ].join("\n"),
    );
  });

  it("names the project variable the client secret is saved as", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce(["google"] as never);
    vi.mocked(text).mockResolvedValueOnce("client-id" as never);
    vi.mocked(password).mockResolvedValueOnce("the-secret" as never);

    await new SocialSignInPrompt().ask(baseAnswers(), ctx);

    expect(vi.mocked(password).mock.calls[0]?.[0]?.message).toBe(
      "Client secret (saved as the project variable GOOGLE_CLIENT_SECRET)",
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
        label: "Another OpenID Connect (OIDC) provider — requires provider configuration",
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

    it("warns about an issuer on this machine that was typed in, naming the allow list", async () => {
      takeReportedWarnings();
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      vi.mocked(text)
        .mockResolvedValueOnce("acme-sso" as never)
        .mockResolvedValueOnce("Acme SSO" as never)
        .mockResolvedValueOnce("http://localhost:9100" as never)
        .mockResolvedValueOnce("openid" as never)
        .mockResolvedValueOnce("acme-client-id" as never);
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      expect(takeReportedWarnings().join(" ")).toContain("NEXTGEN_HTTPCLIENT_ALLOW_LIST");
    });

    it("says nothing about an issuer elsewhere", async () => {
      takeReportedWarnings();
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      expect(takeReportedWarnings()).toEqual([]);
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
      expect(shown).toContain("http://localhost:4321/__nextgen/idp/acme-sso/callback");
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

    it("will not take an empty client secret, so the connection cannot be left without one", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      describeAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

      await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      type Validate = (value: string) => string | undefined;
      const { validate } = vi.mocked(password).mock.calls.at(-1)![0] as { validate: Validate };
      expect(validate("")).toBeTruthy();
      expect(validate("   ")).toBeTruthy();
      expect(validate("something")).toBeUndefined();
    });

    it("drops the connection on an empty client id, naming the command that adds it later", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"] as never);
      vi.mocked(text)
        .mockResolvedValueOnce("acme-sso" as never)
        .mockResolvedValueOnce("Acme SSO" as never)
        .mockResolvedValueOnce("https://sso.acme.example" as never)
        .mockResolvedValueOnce("openid profile email" as never)
        .mockResolvedValueOnce("" as never);

      const answers = await new SocialSignInPrompt().ask(baseAnswers(), ctx);

      expect(answers.sso).toEqual([]);
      expect(password).not.toHaveBeenCalled();
      // The connection as described, so the later command asks only for the
      // credentials.
      expect(vi.mocked(log.info).mock.calls[0]?.[0]).toContain(
        "npx @zitadel/cli@1.2.3 auth-method sso enable --provider custom --slug acme-sso",
      );
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

  it("does not let a provider the command line named be dropped", async () => {
    vi.mocked(text).mockResolvedValueOnce("client-id" as never);
    vi.mocked(password).mockResolvedValueOnce("a-secret" as never);
    const seeded = baseAnswers({ sso: [{ selection: googleSelection, credentials: {} }] });

    await new SocialSignInPrompt().ask(seeded, { ...ctx, ssoFromFlag: true });

    const question = vi.mocked(text).mock.calls[0]?.[0] as {
      message: string;
      validate: (value: string) => string | undefined;
    };
    expect(question.message).toBe("Client ID (Google)");
    expect(question.validate("")).toBeTruthy();
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

  it("throws E_CANCELLED on Ctrl-C at the provider question", async () => {
    vi.mocked(select).mockResolvedValueOnce(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(new SocialSignInPrompt().ask(baseAnswers(), ctx)).rejects.toMatchObject({
      code: "E_CANCELLED",
    });
  });
});

describe("askCustomSettings", () => {
  beforeEach(() => {
    vi.mocked(text).mockReset();
  });

  it("asks for nothing when every setting was given", async () => {
    const given = {
      slug: "acme-sso",
      displayName: "Acme SSO",
      issuer: "https://sso.acme.example",
      scopes: "openid",
    };

    expect(await askCustomSettings(given, ask)).toEqual(given);
    expect(text).not.toHaveBeenCalled();
  });

  const EVERYTHING = {
    slug: "acme-sso",
    displayName: "Acme SSO",
    issuer: "https://sso.acme.example",
    scopes: "openid",
  };
  const QUESTIONS = {
    slug: "Name for this connection",
    displayName: "Name shown on the sign-in button",
    issuer: "Issuer URL of the provider",
    scopes: "Scopes to request",
  };

  it.each([
    [["slug"], ["displayName", "issuer", "scopes"]],
    [
      ["displayName", "scopes"],
      ["slug", "issuer"],
    ],
    [["slug", "displayName", "issuer"], ["scopes"]],
    [[], ["slug", "displayName", "issuer", "scopes"]],
  ] as const)("given %j asks only for %j, in that order", async (givenKeys, askedKeys) => {
    const given = Object.fromEntries(givenKeys.map((key) => [key, EVERYTHING[key]]));
    vi.mocked(text).mockImplementation(
      (async ({ message }: { message: string }) =>
        Object.values(EVERYTHING)[
          Object.values(QUESTIONS).findIndex((question) => message.startsWith(question))
        ]) as never,
    );

    await askCustomSettings(given, ask);

    expect(vi.mocked(text).mock.calls.map(([options]) => options.message)).toEqual(
      askedKeys.map((key) => expect.stringContaining(QUESTIONS[key])),
    );
  });

  it.each([
    ["slug", "Not A Slug"],
    ["issuer", "not a url"],
  ] as const)("refuses a given %s that does not parse, without asking", async (key, value) => {
    await expect(askCustomSettings({ ...EVERYTHING, [key]: value }, ask)).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
    expect(text).not.toHaveBeenCalled();
  });

  it("returns the scopes that were given as one string", async () => {
    const values = await askCustomSettings({ ...EVERYTHING, scopes: "openid  email" }, ask);

    expect(values.scopes).toBe("openid email");
  });

  it("asks only for the settings that were left out", async () => {
    vi.mocked(text).mockResolvedValueOnce("Acme SSO" as never);
    vi.mocked(text).mockResolvedValueOnce("openid groups" as never);

    const values = await askCustomSettings(
      {
        slug: "acme-sso",
        issuer: "https://sso.acme.example",
      },
      ask,
    );

    expect(vi.mocked(text)).toHaveBeenCalledTimes(2);
    expect(values).toEqual({
      slug: "acme-sso",
      displayName: "Acme SSO",
      issuer: "https://sso.acme.example",
      scopes: "openid groups",
    });
  });
});
