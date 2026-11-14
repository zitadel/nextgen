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

import { confirm, isCancel, multiselect, password, text } from "@clack/prompts";
import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { askCustomSettings } from "@/cli/commands/setup/shared";
import { ChooseSocialSignIn } from "@/cli/commands/setup/steps/choose-social-sign-in";
import type { SetupFlags } from "@/cli/commands/setup";
import type { SetupAnswers } from "@/cli/commands/setup/shared";
import type { Ui } from "@/lib/ui";
import { ZitadelError } from "@/lib/errors";
import { asker } from "@/lib/input";
import { LocalServer } from "@/lib/local-server/server";
import { takeReportedWarnings } from "@/lib/warnings";
import { aSuggest } from "@tests/helpers/suggestions";
import { acmeSelection, clientId, clientSecret, googleSelection } from "@tests/helpers/idp-values";
import { rejectionOf } from "@tests/helpers/thrown-value";
import { aQuestionDeps } from "@tests/helpers/setup";

/**
 * The hosted cloud, the server a run falls back to.
 */
const CLOUD = "https://preview.zitadel.com";

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
const QUESTION = { displayName: 0, slug: 1, issuer: 2, scopes: 3 } as const;

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
 */
const ask = asker({ interactive: true, force: false });

/**
 * The boxes the step drew.
 */
const noted = vi.fn<(title: string, lines: readonly string[]) => void>();

/**
 * The lines the step said.
 */
const said = vi.fn<(text: string) => void>();

/**
 * A box a prompt drew, as the one string the reader sees.
 *
 * @param call - Which box, counting from the first.
 * @returns The box's title and body.
 */
function noteShown(call = 0): { title?: string; body: string } {
  const [title, lines] = noted.mock.calls[call] ?? [];
  return { title, body: (lines ?? []).join("\n") };
}

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
 * Answers the Acme connection's four questions, then its client id.
 *
 * @param overrides - The issuer or client id to answer instead.
 * @returns Nothing; the text prompt is primed.
 */
function describesAcme(overrides: { issuer?: string; clientId?: string } = {}): void {
  vi.mocked(text)
    .mockResolvedValueOnce(" Acme SSO ")
    .mockResolvedValueOnce(" acme-sso ")
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

/**
 * The step, run for an interactive setup that was given `options`.
 *
 * @param answers - The answers so far.
 * @param options - What the run was given.
 * @param options.flags - The flags the command line carried.
 * @param options.developmentBuild - Whether this is a development run.
 * @returns The answers the step settled.
 */
async function socialFor(
  answers: SetupAnswers,
  options: { flags?: Partial<SetupFlags>; developmentBuild?: boolean } = {},
): Promise<SetupAnswers> {
  vi.stubEnv("ZITADEL_CLI_DEV", options.developmentBuild === true ? "1" : "");
  return (
    await new ChooseSocialSignIn({
      ...aQuestionDeps(),
      suggest: aSuggest({ envFile: ".env.development.local" }, "1.2.3"),
      ui: UI,
    }).run({
      flags: (options.flags ?? {}) as SetupFlags,
      answers,
    } as Parameters<ChooseSocialSignIn["run"]>[0])
  ).answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCancel).mockReturnValue(false);
  vi.mocked(LocalServer.detectUrl).mockResolvedValue(undefined);
  vi.mocked(LocalServer.isPortFree).mockResolvedValue(true);
});

describe("ChooseSocialSignIn", () => {
  describe("when no provider is wanted", () => {
    it("leaves the answers alone", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const answers = await socialFor(setupAnswers());

      expect(answers.sso).toEqual([]);
    });

    it("asks before going on without SSO, where No goes back", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await socialFor(setupAnswers());

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
        message: "Would you like to continue without setting up SSO?",
        initialValue: false,
      });
    });

    it("asks for the providers again when Go back is chosen", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await socialFor(setupAnswers());

      expect(vi.mocked(multiselect)).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["text", text],
      ["password", password],
    ])("asks no %s question", async (_kind, prompt) => {
      vi.mocked(multiselect).mockResolvedValueOnce([]);
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await socialFor(setupAnswers());

      expect(prompt).not.toHaveBeenCalled();
    });
  });

  it("offers every catalog provider and a custom one, with no option meaning none", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await socialFor(setupAnswers());

    expect(
      vi.mocked(multiselect).mock.calls[0]?.[0].options.map((option) => {
        return option.value;
      }),
    ).toEqual([...IDP_PROVIDERS, "custom"]);
  });

  it("says that Space selects a provider and Enter continues", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await socialFor(setupAnswers());

    expect(vi.mocked(multiselect).mock.calls[0]?.[0].message).toBe(
      "Which external sign-in providers would you like to add? Use Space to select and Enter to continue.",
    );
  });

  it("says what each provider requires", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await socialFor(setupAnswers());

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

      const answers = await socialFor(setupAnswers());

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
      vi.mocked(confirm).mockResolvedValueOnce(false);
      vi.mocked(text).mockResolvedValueOnce("1234-abc.apps.googleusercontent.com");
      vi.mocked(password).mockResolvedValueOnce("s3cret");

      const answers = await socialFor(setupAnswers());

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

      await socialFor(setupAnswers({ devPort: 4321 }));

      expect(noteShown().body).toContain(GOOGLE_CALLBACK);
    });

    it("names the project variable the client secret is saved as", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("the-secret");

      await socialFor(setupAnswers());

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

        await socialFor(setupAnswers());

        expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])(secret)).toBeTruthy();
      },
    );

    it("takes a secret", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text).mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("the-secret");

      await socialFor(setupAnswers());

      expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])("a-secret")).toBeUndefined();
    });

    it("asks where the provider lives on a development build", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
      vi.mocked(text)
        .mockResolvedValueOnce("http://localhost:9100")
        .mockResolvedValueOnce("client-id");
      vi.mocked(password).mockResolvedValueOnce("the-secret");

      const answers = await socialFor(setupAnswers(), { developmentBuild: true });

      expect(answers.sso[0]?.endpoints).toEqual({ issuer: "http://localhost:9100" });
    });

    describe("on a released build", () => {
      it("leaves the provider at its own issuer", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
        vi.mocked(text).mockResolvedValueOnce("client-id");
        vi.mocked(password).mockResolvedValueOnce("the-secret");

        const answers = await socialFor(setupAnswers(), { developmentBuild: false });

        expect(answers.sso[0]?.endpoints).toBeUndefined();
      });

      it("asks only for the client id", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["google"]);
        vi.mocked(text).mockResolvedValueOnce("client-id");
        vi.mocked(password).mockResolvedValueOnce("the-secret");

        await socialFor(setupAnswers(), { developmentBuild: false });

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
      const answers = await socialFor(setupAnswers());

      expect(answers.sso).toEqual([]);
    });

    it("does not ask for its secret", async () => {
      await socialFor(setupAnswers());

      expect(password).not.toHaveBeenCalled();
    });

    it("says the client id may be left empty to skip", async () => {
      await socialFor(setupAnswers());

      expect(vi.mocked(text).mock.calls[0]?.[0].message).toBe(
        "What is the client ID of your Google OAuth app? Leave it empty to skip.",
      );
    });

    it("says how to add it later", async () => {
      await socialFor(setupAnswers());

      expect(said).toHaveBeenCalledWith(
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
      vi.mocked(confirm).mockResolvedValueOnce(true);

      await socialFor(setupAnswers());

      expect(vi.mocked(multiselect).mock.calls[0]?.[0].options.at(-1)).toMatchObject({
        value: "custom",
        label: "Another OpenID Connect (OIDC) provider — requires provider configuration",
      });
    });

    it("asks what the connection is, then for its credentials", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      const answers = await socialFor(setupAnswers());

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

      await socialFor(setupAnswers());

      expect(takeReportedWarnings().join(" ")).toContain("NEXTGEN_HTTPCLIENT_ALLOW_LIST");
    });

    it("says nothing about an issuer elsewhere", async () => {
      takeReportedWarnings();
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers());

      expect(takeReportedWarnings()).toEqual([]);
    });

    it("names the secret's variable after the connection, not after 'custom'", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers());

      expect(vi.mocked(password).mock.calls.at(-1)?.[0].message).toContain(
        "ACME_SSO_CLIENT_SECRET",
      );
    });

    it.each([ACME_CALLBACK, ACME_ISSUER])("shows %s in the note", async (shown) => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers({ devPort: 4321 }));

      expect(noteShown().body).toContain(shown);
    });

    it("leaves nothing undefined in the note", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers({ devPort: 4321 }));

      expect(noteShown().body).not.toContain("undefined");
    });

    it("titles the note after the connection", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers({ devPort: 4321 }));

      expect(noteShown().title).toBe("Acme SSO sign-in");
    });

    describe("on a development build", () => {
      it("asks only for the slug, display name, issuer, scopes and client id", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme();
        vi.mocked(password).mockResolvedValueOnce("acme-secret");

        await socialFor(setupAnswers(), { developmentBuild: true });

        expect(text).toHaveBeenCalledTimes(5);
      });

      it("never asks where the provider lives", async () => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme();
        vi.mocked(password).mockResolvedValueOnce("acme-secret");

        const answers = await socialFor(setupAnswers(), { developmentBuild: true });

        expect(answers.sso[0]?.endpoints).toBeUndefined();
      });
    });

    it.each([
      ["slug", "Acme", "Use lowercase letters"],
      ["slug", "google", "built-in provider"],
      ["displayName", "  ", "The name shown on the sign-in button is empty"],
      ["issuer", "http://sso.acme.example", "Use an https:// URL"],
      ["scopes", "profile email", "openid"],
    ] as const)("refuses the %s %j as the server would", async (question, value, says) => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers());

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

      await socialFor(setupAnswers());

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

        await socialFor(setupAnswers());

        expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])(secret)).toBeTruthy();
      },
    );

    it("takes a client secret", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
      describesAcme();
      vi.mocked(password).mockResolvedValueOnce("acme-secret");

      await socialFor(setupAnswers());

      expect(validatorOf(vi.mocked(password).mock.calls.at(-1)?.[0])("something")).toBeUndefined();
    });

    describe("when its client id is left empty", () => {
      beforeEach(() => {
        vi.mocked(multiselect).mockResolvedValueOnce(["custom"]);
        describesAcme({ clientId: "" });
      });

      it("drops the connection", async () => {
        const answers = await socialFor(setupAnswers());

        expect(answers.sso).toEqual([]);
      });

      it("does not ask for its secret", async () => {
        await socialFor(setupAnswers());

        expect(password).not.toHaveBeenCalled();
      });

      it("names the command that adds the connection as described later", async () => {
        await socialFor(setupAnswers());

        expect(said.mock.calls[0]?.[0]).toContain(
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
        await socialFor(setupAnswers({ sso: [{ selection: acmeSelection, credentials: {} }] }), {
          flags: { sso: "google" },
        });

        expect(text).toHaveBeenCalledTimes(1);
      });

      it("uses the description from the flags", async () => {
        const answers = await socialFor(
          setupAnswers({ sso: [{ selection: acmeSelection, credentials: {} }] }),
          { flags: { sso: "google" } },
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
      await socialFor(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(multiselect).not.toHaveBeenCalled();
    });

    it("does not ask for the client id", async () => {
      await socialFor(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(text).not.toHaveBeenCalled();
    });

    it("keeps the provider", async () => {
      const answers = await socialFor(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(answers.sso[0]?.selection).toEqual(googleSelection);
    });

    it("keeps the client id", async () => {
      const answers = await socialFor(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(answers.sso[0]?.credentials.clientId).toBe("from-the-flag");
    });

    it("refuses a claim the schema cannot take without asking for the secret", async () => {
      const error = await rejectionOf(() => {
        return socialFor(
          setupAnswers({
            sso: [
              {
                selection: googleSelection,
                credentials: { clientId: clientId("from-the-flag") },
                claimRequest: {
                  entries: [{ attribute: "notAProperty", claim: "employee_id" }],
                  verified: [],
                  scopes: [],
                },
              },
            ],
          }),
          { flags: { sso: "google" } },
        );
      });

      expect(error).toMatchObject({ code: "E_VALIDATION" });
      expect(password).not.toHaveBeenCalled();
    });

    it("still asks once for the secret, which is never a flag", async () => {
      await socialFor(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(password).toHaveBeenCalledOnce();
    });

    it("keeps the secret typed after the flag", async () => {
      const answers = await socialFor(
        setupAnswers({
          sso: [
            { selection: googleSelection, credentials: { clientId: clientId("from-the-flag") } },
          ],
        }),
        { flags: { sso: "google" } },
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
      await socialFor(setupAnswers({ sso: [{ selection: googleSelection, credentials: {} }] }), {
        flags: { sso: "google" },
      });

      expect(vi.mocked(text).mock.calls[0]?.[0].message).toBe(
        "What is the client ID of your Google OAuth app?",
      );
    });

    it("does not let the provider be dropped with an empty client id", async () => {
      await socialFor(setupAnswers({ sso: [{ selection: googleSelection, credentials: {} }] }), {
        flags: { sso: "google" },
      });

      expect(validatorOf(vi.mocked(text).mock.calls[0]?.[0])("")).toBeTruthy();
    });
  });

  describe("with a secret already piped in", () => {
    it("does not ask again", async () => {
      await socialFor(
        setupAnswers({
          sso: [
            {
              selection: googleSelection,
              credentials: { clientId: clientId("from-the-flag"), secret: clientSecret("piped") },
            },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(password).not.toHaveBeenCalled();
    });

    it("keeps it", async () => {
      const answers = await socialFor(
        setupAnswers({
          sso: [
            {
              selection: googleSelection,
              credentials: { clientId: clientId("from-the-flag"), secret: clientSecret("piped") },
            },
          ],
        }),
        { flags: { sso: "google" } },
      );

      expect(answers.sso[0]?.credentials.secret).toBe("piped");
    });
  });

  it("refuses with E_CANCELLED on Ctrl-C at the provider question", async () => {
    vi.mocked(multiselect).mockResolvedValueOnce(CANCEL);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const error = await rejectionOf(() => {
      return socialFor(setupAnswers());
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
    [[], ["displayName", "slug", "issuer", "scopes"]],
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

  it("suggests the slug from the display name it was asked first", async () => {
    vi.mocked(text).mockResolvedValueOnce("Zitadel Cloud").mockResolvedValueOnce("zitadel-cloud");

    await askCustomSettings({ issuer: ACME_ISSUER, scopes: "openid" }, ask);

    expect(vi.mocked(text).mock.calls[1]?.[0]).toMatchObject({
      message: expect.stringContaining("What would you like to call this connection?"),
      initialValue: "zitadel-cloud",
    });
  });

  it.each(["Google", "Custom"])(
    "suggests no slug for the built-in provider name %j",
    async (displayName) => {
      vi.mocked(text).mockResolvedValueOnce(displayName).mockResolvedValueOnce("acme-sso");

      await askCustomSettings({ issuer: ACME_ISSUER, scopes: "openid" }, ask);

      expect(vi.mocked(text).mock.calls[1]?.[0]).toMatchObject({ initialValue: "" });
    },
  );

  it("suggests no slug when the display name has nothing a slug can keep", async () => {
    vi.mocked(text).mockResolvedValueOnce("!!!").mockResolvedValueOnce("slug");

    await askCustomSettings({ issuer: ACME_ISSUER, scopes: "openid" }, ask);

    expect(vi.mocked(text).mock.calls[1]?.[0]).toMatchObject({ initialValue: "" });
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
