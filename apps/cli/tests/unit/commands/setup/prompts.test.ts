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

import { confirm, isCancel, log, multiselect, note, password, select, text } from "@clack/prompts";
import { IDP_PROVIDERS } from "@zitadel/config/idp";

import {
  askCustomSettings,
  DevPortPrompt,
  FrameworkConfirmPrompt,
  PasswordPolicyPrompt,
  PickFrameworkPrompt,
  type PromptContext,
  ServerPrompt,
  SETUP_PROMPTS,
  type SetupAnswers,
  SignInPresetPrompt,
  SocialSignInPrompt,
  UseCasePrompt,
} from "@/commands/setup/prompts";
import { ZitadelError } from "@/lib/errors";
import { type Asker, input } from "@/lib/input";
import { LocalServer } from "@/lib/local-server/server";
import { environmentSelectorSuffix } from "@/lib/oclif/environment-flags";
import { projectCommand } from "@/lib/suggestion";
import { takeReportedWarnings } from "@/lib/warnings";
import { acmeSelection, clientId, clientSecret, googleSelection } from "@tests/helpers/idp-values";
import { rejectionOf } from "@tests/helpers/thrown-value";

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
 * What a cancelled prompt answers.
 */
const CANCEL = Symbol("cancel");

/**
 * The redirect URI a Google provider registers when the app runs on port 4321.
 */
const GOOGLE_CALLBACK = "http://localhost:4321/__nextgen/idp/google/callback";

/**
 * The redirect URI the Acme connection registers when the app runs on port 4321.
 */
const ACME_CALLBACK = "http://localhost:4321/__nextgen/idp/acme-sso/callback";

/**
 * The Acme connection's issuer.
 */
const ACME_ISSUER = "https://sso.acme.example";

/**
 * The order the custom connection's questions are asked in.
 */
const QUESTION = { slug: 0, displayName: 1, issuer: 2, scopes: 3 } as const;

/**
 * A custom connection's settings, every one of them given.
 */
const EVERYTHING = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: ACME_ISSUER,
  scopes: "openid",
};

/**
 * How each custom connection setting's question begins.
 */
const QUESTIONS = {
  slug: "What would you like to call this connection?",
  displayName: "What name should the sign-in button show?",
  issuer: "What is the issuer URL of the provider?",
  scopes: "Which scopes should we request?",
};

/**
 * How the wizard asks: interactively, without `--force`.
 *
 * @param question - The question.
 * @returns The answer.
 */
const ask: Asker = (question) => {
  return input(question, { interactive: true, force: false });
};

/**
 * What every prompt is given, as setup builds it: its suggestions are aimed
 * at the project setup creates.
 */
const CONTEXT: PromptContext = {
  input: ask,
  framework: FRAMEWORK,
  cwd: APP_DIR,
  suggest: (args) => {
    return projectCommand(
      args,
      environmentSelectorSuffix({ envFile: ".env.development.local" }),
      "1.2.3",
    );
  },
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
 * Answers the Acme connection's four questions, then its client id.
 *
 * @param overrides - The issuer or client id to answer instead.
 * @returns Nothing; the text prompt is primed.
 */
function describesAcme(overrides: { issuer?: string; clientId?: string } = {}): void {
  vi.mocked(text)
    .mockResolvedValueOnce(" acme-sso ")
    .mockResolvedValueOnce(" Acme SSO ")
    .mockResolvedValueOnce(overrides.issuer ?? ` ${ACME_ISSUER} `)
    .mockResolvedValueOnce("openid profile email groups")
    .mockResolvedValueOnce(overrides.clientId ?? "acme-client-id");
}

/**
 * The check a question applies to each answer.
 *
 * @param question - The question, as clack was given it.
 * @returns The check: why an answer is refused, or `undefined`.
 */
function validatorOf(
  question: { validate?: Parameters<typeof text>[0]["validate"] } | undefined,
): (value: string) => string | Error | undefined {
  const validate = question?.validate;
  if (typeof validate !== "function") {
    throw new Error("the question has no validator");
  }
  return validate;
}

/**
 * Answers each custom connection setting's question with its value from
 * {@link EVERYTHING}.
 *
 * @param message - The question asked.
 * @returns The answer.
 */
async function answerFromEverything({ message }: { message: string }): Promise<string> {
  const key = Object.entries(QUESTIONS).find(([, question]) => {
    return message.startsWith(question);
  })?.[0];
  return (
    Object.entries(EVERYTHING).find(([name]) => {
      return name === key;
    })?.[1] ?? ""
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("FrameworkConfirmPrompt", () => {
  describe("when the developer confirms", () => {
    it("returns the answers unchanged", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const answers = await new FrameworkConfirmPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers).toEqual(setupAnswers());
    });

    it("asks whether to set up Zitadel in the detected app", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await new FrameworkConfirmPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
        message: "Would you like to set up Zitadel in this Next.js app?",
      });
    });
  });

  describe("when the developer already chose the framework", () => {
    it("returns the answers unchanged", async () => {
      const answers = await new FrameworkConfirmPrompt().ask(setupAnswers(), {
        ...CONTEXT,
        frameworkChosen: true,
      });

      expect(answers).toEqual(setupAnswers());
    });

    it("does not ask", async () => {
      await new FrameworkConfirmPrompt().ask(setupAnswers(), { ...CONTEXT, frameworkChosen: true });

      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("when the developer declines", () => {
    it("refuses with E_UNSUPPORTED_PROJECT_SHAPE", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return new FrameworkConfirmPrompt().ask(setupAnswers(), CONTEXT);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_UNSUPPORTED_PROJECT_SHAPE" });
    });

    it("says nothing changed and points at the app's own directory, not --framework", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const error = await rejectionOf(() => {
        return new FrameworkConfirmPrompt().ask(setupAnswers(), CONTEXT);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        message: "Setup stopped before changing this Next.js app",
        hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
      });
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new FrameworkConfirmPrompt().ask(setupAnswers(), CONTEXT);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("ServerPrompt", () => {
  describe("when the cloud is chosen", () => {
    it("writes the cloud", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      const answers = await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.server).toBe(CLOUD);
    });

    it("does not ask for a URL", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when a custom URL is chosen", () => {
    it("writes the URL entered", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      const answers = await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.server).toBe("https://zitadel.internal");
    });

    it("asks for the URL once", async () => {
      vi.mocked(select).mockResolvedValueOnce(CUSTOM_SERVER);
      vi.mocked(text).mockResolvedValueOnce("https://zitadel.internal");

      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(text).toHaveBeenCalledOnce();
    });
  });

  describe("when a local server is detected", () => {
    beforeEach(() => {
      vi.mocked(LocalServer.detectUrl).mockResolvedValueOnce(LOCAL);
      vi.mocked(select).mockResolvedValueOnce(LOCAL);
    });

    it("looks for it in the app directory", async () => {
      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(LocalServer.detectUrl).toHaveBeenCalledWith(APP_DIR);
    });

    it("writes it when it is picked", async () => {
      const answers = await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.server).toBe(LOCAL);
    });

    it("does not ask for a URL when it is picked", async () => {
      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });

    it("preselects it", async () => {
      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: LOCAL });
    });

    it("lists it between the cloud and a custom URL", async () => {
      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(
        vi.mocked(select).mock.calls[0]?.[0].options.map((option) => {
          return option.value;
        }),
      ).toEqual([CLOUD, LOCAL, CUSTOM_SERVER]);
    });

    it("labels it with its URL", async () => {
      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0].options[1]).toMatchObject({
        label: "Local server (http://localhost:8080)",
      });
    });
  });

  describe("when no local server is detected", () => {
    it("lists the local server as unavailable, saying how to start it", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0].options).toEqual([
        { value: CLOUD, label: "Zitadel Cloud (preview.zitadel.com)" },
        {
          value: "__local_not_running__",
          label: "Local server",
          hint: "not running — run zitadel start first",
          disabled: true,
        },
        { value: CUSTOM_SERVER, label: "Custom URL (self-hosted)" },
      ]);
    });

    it("preselects the cloud", async () => {
      vi.mocked(select).mockResolvedValueOnce(CLOUD);

      await new ServerPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: CLOUD });
    });
  });

  it("asks which server the app uses, not which one a file points to", async () => {
    vi.mocked(select).mockResolvedValueOnce(CLOUD);

    await new ServerPrompt().ask(setupAnswers(), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0].message).toBe(
      "Which Zitadel server should your app use?",
    );
  });

  describe("with --server", () => {
    it("keeps the pinned server", async () => {
      const answers = await new ServerPrompt().ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(answers).toEqual(setupAnswers({ server: LOCAL }));
    });

    it("does not look for a local server", async () => {
      await new ServerPrompt().ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(LocalServer.detectUrl).not.toHaveBeenCalled();
    });

    it("does not ask", async () => {
      await new ServerPrompt().ask(setupAnswers({ server: LOCAL }), {
        ...CONTEXT,
        serverFlag: "local",
      });

      expect(select).not.toHaveBeenCalled();
    });
  });
});

describe("DevPortPrompt", () => {
  describe("when the detected port is free", () => {
    it("checks the detected port", async () => {
      await new DevPortPrompt().ask(setupAnswers({ devPort: 3000 }), CONTEXT);

      expect(LocalServer.isPortFree).toHaveBeenCalledWith(3000);
    });

    it("keeps the detected port", async () => {
      const answers = await new DevPortPrompt().ask(setupAnswers({ devPort: 3000 }), CONTEXT);

      expect(answers.devPort).toBe(3000);
    });

    it("does not ask", async () => {
      await new DevPortPrompt().ask(setupAnswers({ devPort: 3000 }), CONTEXT);

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when the detected port is taken", () => {
    beforeEach(() => {
      vi.mocked(LocalServer.isPortFree).mockResolvedValue(false);
      vi.mocked(LocalServer.nextFreePort).mockImplementation((port) => {
        return Promise.resolve(port + 1);
      });
    });

    it("parses the entered text into a number", async () => {
      vi.mocked(text).mockResolvedValueOnce("4000");

      const answers = await new DevPortPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.devPort).toBe(4000);
    });

    it("looks for the next free port after it", async () => {
      vi.mocked(text).mockResolvedValueOnce("5174");

      await new DevPortPrompt().ask(setupAnswers({ devPort: 5173 }), CONTEXT);

      expect(LocalServer.nextFreePort).toHaveBeenCalledWith(5173);
    });

    it("says the port is in use and suggests the next free one", async () => {
      vi.mocked(text).mockResolvedValueOnce("5174");

      await new DevPortPrompt().ask(setupAnswers({ devPort: 5173 }), CONTEXT);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({
        message: "Port 5173 is in use. Which port should your app run on?",
        initialValue: "5174",
      });
    });

    it("suggests the taken port when the next ones are taken too", async () => {
      vi.mocked(LocalServer.nextFreePort).mockResolvedValue(undefined);
      vi.mocked(text).mockResolvedValueOnce("5173");

      await new DevPortPrompt().ask(setupAnswers({ devPort: 5173 }), CONTEXT);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({ initialValue: "5173" });
    });
  });

  describe("with --dev-port", () => {
    it("keeps the flagged port", async () => {
      vi.mocked(LocalServer.isPortFree).mockResolvedValue(false);

      const answers = await new DevPortPrompt().ask(setupAnswers({ devPort: 5000 }), {
        ...CONTEXT,
        devPortFromFlag: true,
      });

      expect(answers.devPort).toBe(5000);
    });

    it("does not ask", async () => {
      vi.mocked(LocalServer.isPortFree).mockResolvedValue(false);

      await new DevPortPrompt().ask(setupAnswers({ devPort: 5000 }), {
        ...CONTEXT,
        devPortFromFlag: true,
      });

      expect(text).not.toHaveBeenCalled();
    });
  });
});

describe("PasswordPolicyPrompt", () => {
  it("records the chosen minimum", async () => {
    vi.mocked(select).mockResolvedValueOnce(15);

    const answers = await new PasswordPolicyPrompt().ask(setupAnswers(), CONTEXT);

    expect(answers.passwordMinLength).toBe(15);
  });

  it("offers 15, 8 or none, with 15 preselected as the recommendation", async () => {
    vi.mocked(select).mockResolvedValueOnce(15);

    await new PasswordPolicyPrompt().ask(setupAnswers(), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which minimum length should passwords have? You can change it later.",
      initialValue: 15,
      options: [
        { value: 15, label: "15 characters — recommended" },
        { value: 8, label: "8 characters" },
        { value: null, label: "No minimum" },
      ],
    });
  });

  it("records no minimum as none", async () => {
    vi.mocked(select).mockResolvedValueOnce(null);

    const answers = await new PasswordPolicyPrompt().ask(setupAnswers(), CONTEXT);

    expect(answers.passwordMinLength).toBeNull();
  });

  describe("with --password-min-length", () => {
    it("keeps the flagged minimum", async () => {
      const answers = await new PasswordPolicyPrompt().ask(
        setupAnswers({ passwordMinLength: 10 }),
        { ...CONTEXT, passwordMinLengthFromFlag: true },
      );

      expect(answers.passwordMinLength).toBe(10);
    });

    it("does not ask", async () => {
      await new PasswordPolicyPrompt().ask(setupAnswers({ passwordMinLength: 10 }), {
        ...CONTEXT,
        passwordMinLengthFromFlag: true,
      });

      expect(select).not.toHaveBeenCalled();
    });
  });
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

describe("UseCasePrompt", () => {
  it("writes the selected use case into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("business");

    const answers = await new UseCasePrompt().ask(setupAnswers({ useCase: "minimal" }), CONTEXT);

    expect(answers.useCase).toBe("business");
  });

  it("preselects the use case already answered", async () => {
    vi.mocked(select).mockResolvedValueOnce("business");

    await new UseCasePrompt().ask(setupAnswers({ useCase: "minimal" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "minimal" });
  });

  it("asks which registration fields to collect, with every field set in its label", async () => {
    vi.mocked(select).mockResolvedValueOnce("minimal");

    await new UseCasePrompt().ask(setupAnswers({ useCase: "minimal" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which fields should registration collect? You can change them later.",
      options: [
        { value: "minimal", label: "Email only" },
        { value: "consumer", label: "Email, first name and last name" },
        { value: "business", label: "Email, first name, last name and company name" },
      ],
    });
  });

  describe("with --use-case", () => {
    it("keeps the flagged use case", async () => {
      const answers = await new UseCasePrompt().ask(setupAnswers({ useCase: "consumer" }), {
        ...CONTEXT,
        useCaseFromFlag: true,
      });

      expect(answers.useCase).toBe("consumer");
    });

    it("does not ask", async () => {
      await new UseCasePrompt().ask(setupAnswers({ useCase: "consumer" }), {
        ...CONTEXT,
        useCaseFromFlag: true,
      });

      expect(select).not.toHaveBeenCalled();
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new UseCasePrompt().ask(setupAnswers({ useCase: "minimal" }), CONTEXT);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("SignInPresetPrompt", () => {
  it("writes the selected preset into the answers", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey-first");

    const answers = await new SignInPresetPrompt().ask(
      setupAnswers({ preset: "password-first" }),
      CONTEXT,
    );

    expect(answers.preset).toBe("passkey-first");
  });

  it("preselects the preset already answered", async () => {
    vi.mocked(select).mockResolvedValueOnce("passkey-first");

    await new SignInPresetPrompt().ask(setupAnswers({ preset: "password-first" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({ initialValue: "password-first" });
  });

  it("says what users see first and what is secondary, which both presets enable", async () => {
    vi.mocked(select).mockResolvedValueOnce("password-first");

    await new SignInPresetPrompt().ask(setupAnswers({ preset: "password-first" }), CONTEXT);

    expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
      message: "Which sign-in method would you like your users to see first?",
      options: [
        {
          value: "password-first",
          label: "Email and password, with passkeys enabled but not shown at sign-in",
        },
        {
          value: "passkey-first",
          label: "Passkey, with email and password shown as the alternative",
        },
      ],
    });
  });

  describe("with --preset", () => {
    it("keeps the flagged preset", async () => {
      const answers = await new SignInPresetPrompt().ask(
        setupAnswers({ preset: "passkey-first" }),
        { ...CONTEXT, presetFromFlag: true },
      );

      expect(answers.preset).toBe("passkey-first");
    });

    it("does not ask", async () => {
      await new SignInPresetPrompt().ask(setupAnswers({ preset: "passkey-first" }), {
        ...CONTEXT,
        presetFromFlag: true,
      });

      expect(select).not.toHaveBeenCalled();
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C", async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new SignInPresetPrompt().ask(setupAnswers({ preset: "password-first" }), CONTEXT);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("SETUP_PROMPTS", () => {
  /**
   * Setup only gets authentication working; taking ownership of the login
   * template is the opt-in `branding eject`, never a wizard step. Social
   * sign-in configures a way in, which is what setup is for, and it asks last
   * because its answer is the only one that comes from outside the terminal.
   */
  it("asks no login-design question (#1039)", () => {
    const names = SETUP_PROMPTS.map((prompt) => {
      return prompt.constructor.name;
    });

    expect(names).toEqual([
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
  describe("when no provider is wanted", () => {
    it("leaves the answers alone", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(select).mockResolvedValueOnce("skip");

      const answers = await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.sso).toEqual([]);
    });

    it("asks before going on without SSO, with Go back selected", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(select).mockResolvedValueOnce("skip");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
        message: "Would you like to continue without setting up SSO?",
        initialValue: "back",
      });
    });

    it("asks for the providers again when Go back is chosen", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      vi.mocked(select).mockResolvedValueOnce("back").mockResolvedValueOnce("skip");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(multiselect)).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["text", text],
      ["password", password],
    ])("asks no %s question", async (_kind, prompt) => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(select).mockResolvedValueOnce("skip");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(prompt).not.toHaveBeenCalled();
    });
  });

  it("offers every catalog provider and a custom one, with no option meaning none", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);
    vi.mocked(select).mockResolvedValueOnce("skip");

    await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

    expect(
      vi.mocked(multiselect).mock.calls[0]?.[0].options.map((option) => {
        return option.value;
      }),
    ).toEqual([...IDP_PROVIDERS, "custom"]);
  });

  it("says that Space selects a provider and Enter continues", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);
    vi.mocked(select).mockResolvedValueOnce("skip");

    await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

    expect(vi.mocked(multiselect).mock.calls[0]?.[0].message).toBe(
      "Which external sign-in providers would you like to add? Use Space to select and Enter to continue.",
    );
  });

  it("says what each provider requires", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);
    vi.mocked(select).mockResolvedValueOnce("skip");

    await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

    expect(
      vi.mocked(multiselect).mock.calls[0]?.[0].options.map((option) => {
        return option.label;
      }),
    ).toEqual([
      "Google — requires a Google OAuth app",
      "Another OpenID Connect (OIDC) provider — requires provider configuration",
    ]);
  });

  describe("when Google is chosen", () => {
    it("captures the credentials, trimmed", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("  1234-abc.apps.googleusercontent.com  ");
      vi.mocked(password).mockResolvedValueOnce("  s3cret  ");

      const answers = await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.sso).toEqual([
        {
          selection: googleSelection,
          credentials: { clientId: "1234-abc.apps.googleusercontent.com", secret: "s3cret" },
          endpoints: undefined,
        },
      ]);
    });

    it("keeps a provider ticked after Go back", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]).mockResolvedValueOnce(["google"]);
      vi.mocked(select).mockResolvedValueOnce("back");
      vi.mocked(text).mockResolvedValueOnce("1234-abc.apps.googleusercontent.com");
      vi.mocked(password).mockResolvedValueOnce("s3cret");

      const answers = await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.sso).toEqual([
        {
          selection: googleSelection,
          credentials: { clientId: "1234-abc.apps.googleusercontent.com", secret: "s3cret" },
          endpoints: undefined,
        },
      ]);
    });

    it("shows the exact redirect URI to register, on the port answered earlier", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("1234-abc.apps.googleusercontent.com");
      vi.mocked(password).mockResolvedValueOnce("s3cret");

      await new SocialSignInPrompt().ask(setupAnswers({ devPort: 4321 }), CONTEXT);

      expect(vi.mocked(note).mock.calls[0]?.[0]).toContain(GOOGLE_CALLBACK);
    });

    it("names the project variable the client secret is saved as", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("the-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(password).mock.calls[0]?.[0].message).toBe(
        "What is the client secret of your Google OAuth app? It will be stored on the project as GOOGLE_CLIENT_SECRET.",
      );
    });

    it.each(["", "   "])(
      "will not take the empty secret %j, because a provider without one cannot work",
      async (secret) => {
        vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
        vi.mocked(text).mockResolvedValueOnce("client-id");
        vi.mocked(password).mockResolvedValueOnce("the-secret");

        await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

        expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])(secret)).toBeTruthy();
      },
    );

    it("takes a secret", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("the-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])("a-secret")).toBeUndefined();
    });

    it("asks where the provider lives on a development build", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text)
        .mockResolvedValueOnce("http://localhost:9100")
        .mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("the-secret");

      const answers = await new SocialSignInPrompt().ask(setupAnswers(), {
        ...CONTEXT,
        developmentBuild: true,
      });

      expect(answers.sso[0]?.endpoints).toEqual({ issuer: "http://localhost:9100" });
    });

    describe("on a released build", () => {
      it("leaves the provider at its own issuer", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
        vi.mocked(text).mockResolvedValueOnce("client-id");
        vi.mocked(password).mockResolvedValueOnce("the-secret");

        const answers = await new SocialSignInPrompt().ask(setupAnswers(), {
          ...CONTEXT,
          developmentBuild: false,
        });

        expect(answers.sso[0]?.endpoints).toBeUndefined();
      });

      it("asks only for the client id", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
        vi.mocked(text).mockResolvedValueOnce("client-id");
        vi.mocked(password).mockResolvedValueOnce("the-secret");

        await new SocialSignInPrompt().ask(setupAnswers(), {
          ...CONTEXT,
          developmentBuild: false,
        });

        expect(text).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("when Google's client id is left empty", () => {
    beforeEach(() => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("   ");
    });

    it("drops the provider", async () => {
      const answers = await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.sso).toEqual([]);
    });

    it("does not ask for its secret", async () => {
      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(password).not.toHaveBeenCalled();
    });

    it("says the client id may be left empty to skip", async () => {
      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(text).mock.calls[0]?.[0].message).toBe(
        "What is the client ID of your Google OAuth app? Leave it empty to skip.",
      );
    });

    it("says how to add it later", async () => {
      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(log.info).toHaveBeenCalledWith(
        [
          "Skipped Google. Once its OAuth application exists, add it with:",
          "npx @zitadel/cli@1.2.3 auth-method sso enable --provider google --env-file .env.development.local",
        ].join("\n"),
      );
    });
  });

  describe("with a custom provider", () => {
    it("is offered beside the catalog, saying what it will ask for", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(select).mockResolvedValueOnce("skip");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(multiselect).mock.calls[0]?.[0].options.at(-1)).toMatchObject({
        value: "custom",
        label: "Another OpenID Connect (OIDC) provider — requires provider configuration",
      });
    });

    it("asks what the connection is, then for its credentials", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      const answers = await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(answers.sso).toEqual([
        {
          selection: {
            kind: "custom",
            connection: {
              slug: "acme-sso",
              displayName: "Acme SSO",
              issuer: ACME_ISSUER,
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
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme({ issuer: "http://localhost:9100" });
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(takeReportedWarnings().join(" ")).toContain("NEXTGEN_HTTPCLIENT_ALLOW_LIST");
    });

    it("says nothing about an issuer elsewhere", async () => {
      takeReportedWarnings();
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(takeReportedWarnings()).toEqual([]);
    });

    it("names the secret's variable after the connection, not after 'custom'", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(vi.mocked(password).mock.calls.at(-1)?.[0].message).toContain(
        "ACME_SSO_CLIENT_SECRET",
      );
    });

    it.each([ACME_CALLBACK, ACME_ISSUER])("shows %s in the note", async (shown) => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers({ devPort: 4321 }), CONTEXT);

      expect(vi.mocked(note).mock.calls[0]?.[0]).toContain(shown);
    });

    it("leaves nothing undefined in the note", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers({ devPort: 4321 }), CONTEXT);

      expect(vi.mocked(note).mock.calls[0]?.[0]).not.toContain("undefined");
    });

    it("titles the note after the connection", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers({ devPort: 4321 }), CONTEXT);

      expect(vi.mocked(note).mock.calls[0]?.[1]).toBe("Acme SSO sign-in");
    });

    describe("on a development build", () => {
      it("asks only for the slug, display name, issuer, scopes and client id", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme();
        vi.mocked(password).mockResolvedValueOnce("acme-secret");

        await new SocialSignInPrompt().ask(setupAnswers(), { ...CONTEXT, developmentBuild: true });

        expect(text).toHaveBeenCalledTimes(5);
      });

      it("never asks where the provider lives", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme();
        vi.mocked(password).mockResolvedValueOnce("acme-secret");

        const answers = await new SocialSignInPrompt().ask(setupAnswers(), {
          ...CONTEXT,
          developmentBuild: true,
        });

        expect(answers.sso[0]?.endpoints).toBeUndefined();
      });
    });

    it.each([
      ["slug", "Acme", "Use lowercase letters"],
      ["slug", "google", "built-in provider"],
      ["displayName", "  ", "Enter the name shown on the sign-in button"],
      ["issuer", "http://sso.acme.example", "Use an https:// URL"],
      ["scopes", "profile email", "openid"],
    ] as const)("refuses the %s %j as the server would", async (question, value, says) => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(validatorOf(vi.mocked(text).mock.calls[QUESTION[question]]?.[0])(value)).toContain(
        says,
      );
    });

    it.each([
      ["slug", "acme-sso"],
      ["issuer", ACME_ISSUER],
      ["scopes", "openid email"],
    ] as const)("takes the %s %j", async (question, value) => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(
        validatorOf(vi.mocked(text).mock.calls[QUESTION[question]]?.[0])(value),
      ).toBeUndefined();
    });

    it.each(["", "   "])(
      "will not take the empty client secret %j, so the connection cannot be left without one",
      async (secret) => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme();
        vi.mocked(password).mockResolvedValueOnce("acme-secret");

        await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

        expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])(secret)).toBeTruthy();
      },
    );

    it("takes a client secret", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

      expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])("something")).toBeUndefined();
    });

    describe("when its client id is left empty", () => {
      beforeEach(() => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme({ clientId: "" });
      });

      it("drops the connection", async () => {
        const answers = await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

        expect(answers.sso).toEqual([]);
      });

      it("does not ask for its secret", async () => {
        await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

        expect(password).not.toHaveBeenCalled();
      });

      it("names the command that adds the connection as described later", async () => {
        await new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);

        expect(vi.mocked(log.info).mock.calls[0]?.[0]).toContain(
          "npx @zitadel/cli@1.2.3 auth-method sso enable --provider custom --slug acme-sso",
        );
      });
    });

    describe("described by --sso-* flags", () => {
      beforeEach(() => {
        vi.mocked(text).mockResolvedValueOnce("acme-client-id");
        vi.mocked(password).mockResolvedValueOnce("acme-secret");
      });

      it("asks only for the client id", async () => {
        await new SocialSignInPrompt().ask(
          setupAnswers({ sso: [{ selection: acmeSelection, credentials: {} }] }),
          { ...CONTEXT, ssoFromFlag: true },
        );

        expect(text).toHaveBeenCalledTimes(1);
      });

      it("uses the description from the flags", async () => {
        const answers = await new SocialSignInPrompt().ask(
          setupAnswers({ sso: [{ selection: acmeSelection, credentials: {} }] }),
          { ...CONTEXT, ssoFromFlag: true },
        );

        expect(answers.sso[0]?.selection).toEqual(acmeSelection);
      });
    });
  });

  describe("with --sso naming a provider and its client id", () => {
    beforeEach(() => {
      vi.mocked(password).mockResolvedValueOnce("typed-after-the-flag");
    });

    it("does not ask which provider", async () => {
      await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(multiselect).not.toHaveBeenCalled();
    });

    it("does not ask for the client id", async () => {
      await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(text).not.toHaveBeenCalled();
    });

    it("keeps the provider", async () => {
      const answers = await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(answers.sso[0]?.selection).toEqual(googleSelection);
    });

    it("keeps the client id", async () => {
      const answers = await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(answers.sso[0]?.credentials.clientId).toBe("from-the-flag");
    });

    it("still asks once for the secret, which is never a flag", async () => {
      await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(password).toHaveBeenCalledOnce();
    });

    it("keeps the secret typed after the flag", async () => {
      const answers = await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(answers.sso[0]?.credentials.secret).toBe("typed-after-the-flag");
    });
  });

  describe("with --sso naming a provider without its client id", () => {
    beforeEach(() => {
      vi.mocked(text).mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("a-secret");
    });

    it("asks for the client id without offering to skip", async () => {
      await new SocialSignInPrompt().ask(
        setupAnswers({ sso: [{ selection: googleSelection, credentials: {} }] }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(vi.mocked(text).mock.calls[0]?.[0].message).toBe(
        "What is the client ID of your Google OAuth app?",
      );
    });

    it("does not let the provider be dropped with an empty client id", async () => {
      await new SocialSignInPrompt().ask(
        setupAnswers({ sso: [{ selection: googleSelection, credentials: {} }] }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(validatorOf(vi.mocked(text).mock.calls[0]?.[0])("")).toBeTruthy();
    });
  });

  describe("with a secret already piped in", () => {
    it("does not ask again", async () => {
      await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            {
              selection: googleSelection,
              credentials: { clientId: clientId("from-the-flag"), secret: clientSecret("piped") },
            },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(password).not.toHaveBeenCalled();
    });

    it("keeps it", async () => {
      const answers = await new SocialSignInPrompt().ask(
        setupAnswers({
          sso: [
            {
              selection: googleSelection,
              credentials: { clientId: clientId("from-the-flag"), secret: clientSecret("piped") },
            },
          ],
        }),
        { ...CONTEXT, ssoFromFlag: true },
      );

      expect(answers.sso[0]?.credentials.secret).toBe("piped");
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C at the provider question", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return new SocialSignInPrompt().ask(setupAnswers(), CONTEXT);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({ code: "E_CANCELLED" });
  });
});

describe("askCustomSettings", () => {
  beforeEach(() => {
    vi.mocked(text).mockReset();
  });

  describe("when every setting was given", () => {
    it("returns them", async () => {
      const values = await askCustomSettings(EVERYTHING, ask);

      expect(values).toEqual(EVERYTHING);
    });

    it("asks for nothing", async () => {
      await askCustomSettings(EVERYTHING, ask);

      expect(text).not.toHaveBeenCalled();
    });
  });

  it.each([
    [["slug"], ["displayName", "issuer", "scopes"]],
    [
      ["displayName", "scopes"],
      ["slug", "issuer"],
    ],
    [["slug", "displayName", "issuer"], ["scopes"]],
    [[], ["slug", "displayName", "issuer", "scopes"]],
  ] as const)("given %j asks only for %j, in that order", async (givenKeys, askedKeys) => {
    const given = Object.fromEntries(
      givenKeys.map((key) => {
        return [key, EVERYTHING[key]];
      }),
    );
    vi.mocked(text).mockImplementation(answerFromEverything);

    await askCustomSettings(given, ask);

    expect(
      vi.mocked(text).mock.calls.map(([options]) => {
        return options.message;
      }),
    ).toEqual(
      askedKeys.map((key) => {
        return expect.stringContaining(QUESTIONS[key]);
      }),
    );
  });

  describe("with a given setting that does not parse", () => {
    it.each([
      ["slug", "Not A Slug"],
      ["issuer", "not a url"],
    ] as const)("refuses the %s", async (key, value) => {
      const error = await rejectionOf(() => {
        return askCustomSettings({ ...EVERYTHING, [key]: value }, ask);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_VALIDATION" });
    });

    it.each([
      ["slug", "Not A Slug"],
      ["issuer", "not a url"],
    ] as const)("does not ask, given the %s", async (key, value) => {
      await rejectionOf(() => {
        return askCustomSettings({ ...EVERYTHING, [key]: value }, ask);
      });

      expect(text).not.toHaveBeenCalled();
    });
  });

  it("returns the scopes that were given as one string", async () => {
    const values = await askCustomSettings({ ...EVERYTHING, scopes: "openid  email" }, ask);

    expect(values.scopes).toBe("openid email");
  });

  describe("when some settings were left out", () => {
    beforeEach(() => {
      vi.mocked(text).mockResolvedValueOnce("Acme SSO").mockResolvedValueOnce("openid groups");
    });

    it("asks only for those", async () => {
      await askCustomSettings({ slug: "acme-sso", issuer: ACME_ISSUER }, ask);

      expect(text).toHaveBeenCalledTimes(2);
    });

    it("returns the given and the answered settings together", async () => {
      const values = await askCustomSettings({ slug: "acme-sso", issuer: ACME_ISSUER }, ask);

      expect(values).toEqual({
        slug: "acme-sso",
        displayName: "Acme SSO",
        issuer: ACME_ISSUER,
        scopes: "openid groups",
      });
    });
  });
});
