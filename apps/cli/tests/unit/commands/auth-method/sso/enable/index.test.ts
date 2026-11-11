import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
  return (await import("@tests/helpers/clack")).clackDouble();
});

import { password, text } from "@clack/prompts";
import { Errors } from "@oclif/core";

import AuthMethodSsoEnable from "@/commands/auth-method/sso/enable";
import { ZitadelError } from "@/lib/errors";
import type { JsonObject } from "@/lib/zitadel";
import { authMethodJson, authMethodText } from "@tests/helpers/auth-method";
import {
  anOidcConnection,
  authMethods,
  aUserSchema,
  type DocumentsByName,
} from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { withStep } from "@tests/helpers/flows";
import { parseFlag } from "@tests/helpers/inputs";
import {
  defaultSchema,
  loginFlow,
  makeProject,
  readJson,
  setUpProject,
  withStdin,
  writeJson,
} from "@tests/helpers/local-project";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { useTerminal } from "@tests/helpers/terminal";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The custom connection the tests describe.
 */
const ACME = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
  scopes: "openid profile email",
  clientId: "acme-client-id",
  secret: "acme-secret",
  file: ".zitadel/idps/acme-sso.json",
};

/**
 * The flags that make the custom connection {@link ACME}, after `--provider custom`.
 */
const ACME_FLAGS = [
  "--slug",
  ACME.slug,
  "--display-name",
  ACME.displayName,
  "--issuer",
  ACME.issuer,
  "--client-id",
  ACME.clientId,
] as const;

/**
 * A user schema with the attributes given besides the email it signs in by,
 * which the {@link ACME} connection maps.
 *
 * @param properties - The attributes to add.
 * @param required - The attributes the schema requires.
 * @returns The schema.
 */
function aSchemaWith(properties: JsonObject, required: string[] = []): JsonObject {
  return aUserSchema({
    "x-auth-methods": authMethods("password", "passkey"),
    properties: { email: { type: "string", "x-unique": "project" }, ...properties },
    required,
  });
}

/**
 * A connection under another slug, written at the file {@link ACME}'s slug names.
 */
const ANOTHER_CONNECTION = anOidcConnection({ slug: "something-else" });

/**
 * The questions the command asks a person for a custom connection.
 */
const QUESTION = {
  slug: "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
  displayName: "What name should the sign-in button show? For example Acme SSO.",
  issuer: "What is the issuer URL of the provider?",
  scopes: "Which scopes should we request? Separate them with spaces.",
  clientId: "What is the client ID of your Acme SSO OAuth app?",
  secret:
    "What is the client secret of your Acme SSO OAuth app? It will be stored on the project as ACME_SSO_CLIENT_SECRET.",
};

/**
 * The exit codes the CLI ends a refused run with.
 */
const EXIT = { validation: 3, notFound: 4, conflict: 5 } as const;

/**
 * What a script names of a custom connection when it leaves out the rest.
 */
const SLUG_ONLY = ["sso", "enable", "--provider", "custom", "--slug", ACME.slug] as const;

/**
 * What a custom run names before a script adds its own settings.
 */
const CUSTOM = ["sso", "enable", "--provider", "custom"] as const;

/**
 * The refusal of a script that names a custom connection by its slug alone.
 */
const MISSING = "A custom connection needs --display-name, --issuer";

/**
 * The arguments of `auth-method sso enable --provider custom` run from source
 * against the Project in `cwd`.
 *
 * @param cwd - The Project.
 * @param flags - The flags the person typed.
 * @returns The arguments.
 */
function customArgs(cwd: string, ...flags: string[]): string[] {
  return ["--cwd", cwd, "--provider", "custom", ...flags];
}

/**
 * Queues what the person types, in the order the questions come, and the
 * client secret they type last.
 *
 * @param answers - The answers to the text questions.
 */
function typing(...answers: string[]): void {
  for (const answer of answers) {
    vi.mocked(text).mockResolvedValueOnce(answer);
  }
  vi.mocked(password).mockResolvedValueOnce(ACME.secret);
}

/**
 * Makes the person type the slug, then the client id to every later
 * question, and the client secret whenever it is asked for.
 */
function typingTheSlugThenTheClientId(): void {
  vi.mocked(text).mockResolvedValueOnce(ACME.slug);
  vi.mocked(text).mockResolvedValue(ACME.clientId);
  vi.mocked(password).mockResolvedValue(ACME.secret);
}

/**
 * Every question asked so far.
 *
 * @returns The questions, in the order they were asked.
 */
function asked(): string[] {
  return vi.mocked(text).mock.calls.map(([question]) => {
    return question.message;
  });
}

/**
 * A Project with the default schema and these flows that was never linked to a
 * project: it knows its development issuer, and nothing else.
 *
 * @param dir - The directory to write the Project into.
 * @param flows - The login flows, by file name without `.json`.
 * @returns The Project's directory.
 */
async function anUnlinkedProject(dir: string, flows: DocumentsByName): Promise<string> {
  const cwd = await makeProject(dir, { schemas: { "default-human-user": defaultSchema }, flows });
  await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");
  return cwd;
}

/**
 * A Project where a script already created the `acme-sso` connection, with
 * these keys then changed in its file.
 *
 * @param dir - The directory to write the Project into.
 * @param overrides - Top-level keys to set, and `oidc` keys to merge; a key set
 *   to `undefined` is removed, `oidc` included.
 * @returns The Project's directory.
 */
async function aProjectWithAcme(
  dir: string,
  overrides: JsonObject & { oidc?: JsonObject | undefined } = {},
): Promise<string> {
  const cwd = await setUpProject(dir);
  await withStdin(ACME.secret, () => {
    return runCliForTest(
      authMethodText(
        cwd,
        ...CUSTOM,
        "--slug",
        ACME.slug,
        "--display-name",
        ACME.displayName,
        "--issuer",
        ACME.issuer,
        "--client-id",
        ACME.clientId,
      ),
    );
  });
  const written = await readJson(cwd, ACME.file);
  const { oidc, ...rest } = overrides;
  if ("oidc" in overrides && oidc === undefined) {
    await writeJson(cwd, ACME.file, { ...written, ...rest, oidc: undefined });
    return cwd;
  }
  const stored = typeof written.oidc === "object" && written.oidc !== null ? written.oidc : {};
  await writeJson(cwd, ACME.file, { ...written, ...rest, oidc: { ...stored, ...oidc } });
  return cwd;
}

const { server } = usePlatformServer();
useTerminal();

beforeEach(() => {
  vi.mocked(text).mockReset();
  vi.mocked(password).mockReset();
});

describe("auth-method sso enable", () => {
  describe("with --provider custom at a terminal", () => {
    it("asks for the connection's settings, then for its client id", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing(ACME.slug, ACME.displayName, ACME.issuer, "openid email", ACME.clientId);

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(asked()).toEqual([
        QUESTION.slug,
        QUESTION.displayName,
        QUESTION.issuer,
        QUESTION.scopes,
        QUESTION.clientId,
      ]);
    });

    it("asks for the client secret, naming the variable it is stored as", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing(ACME.slug, ACME.displayName, ACME.issuer, "openid email", ACME.clientId);

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(password).toHaveBeenCalledWith(expect.objectContaining({ message: QUESTION.secret }));
    });

    it("writes the settings the person typed", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing(ACME.slug, ACME.displayName, ACME.issuer, "openid email", ACME.clientId);

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(await readJson(cwd, ACME.file)).toMatchObject({
        display_name: ACME.displayName,
        oidc: { issuer: ACME.issuer, scopes: ["openid", "email"] },
      });
    });

    it("asks only for what the flags left out", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing(ACME.displayName, ACME.scopes, ACME.clientId);

      await AuthMethodSsoEnable.run(customArgs(cwd, "--slug", ACME.slug, "--issuer", ACME.issuer));

      expect(asked()).toEqual([QUESTION.displayName, QUESTION.scopes, QUESTION.clientId]);
    });

    it("writes the issuer a flag gave", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing(ACME.displayName, ACME.scopes, ACME.clientId);

      await AuthMethodSsoEnable.run(customArgs(cwd, "--slug", ACME.slug, "--issuer", ACME.issuer));

      expect(await readJson(cwd, ACME.file)).toMatchObject({ oidc: { issuer: ACME.issuer } });
    });

    it("asks only for the client id when the flags gave every setting", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing(ACME.clientId);

      await AuthMethodSsoEnable.run(
        customArgs(
          cwd,
          "--slug",
          ACME.slug,
          "--display-name",
          ACME.displayName,
          "--issuer",
          ACME.issuer,
          "--scopes",
          ACME.scopes,
        ),
      );

      expect(asked()).toEqual([QUESTION.clientId]);
    });
  });

  describe("with a bad --issuer and the slug left to ask for", () => {
    it("refuses the flag as a validation failure", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--issuer", "not a url"));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing first", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--issuer", "not a url"));
      });

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when the typed slug names a provider", () => {
    it("refuses it as a validation failure", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing("google");

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      typing("google");

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(asked()).toEqual([QUESTION.slug]);
    });
  });

  describe("when the schema does not exist", () => {
    it("refuses it as not found", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--schema", "nope"));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.notFound } });
    });

    it.for([
      ["text", text],
      ["password", password],
    ] as const)(
      "asks no %s question, so nobody answers for nothing",
      async ([_, prompt], { dir }) => {
        const cwd = await setUpProject(dir);

        await rejectionOf(() => {
          return AuthMethodSsoEnable.run(customArgs(cwd, "--schema", "nope"));
        });

        expect(prompt).not.toHaveBeenCalled();
      },
    );
  });

  describe("when no login flow runs against the schema of an unlinked Project", () => {
    it("refuses it as not found", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, { elsewhere: loginFlow("another-schema") });

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.notFound } });
    });

    it.for([
      ["text", text],
      ["password", password],
    ] as const)(
      "asks no %s question, not even to link the Project",
      async ([_, prompt], { dir }) => {
        const cwd = await anUnlinkedProject(dir, { elsewhere: loginFlow("another-schema") });

        await rejectionOf(() => {
          return AuthMethodSsoEnable.run(customArgs(cwd));
        });

        expect(prompt).not.toHaveBeenCalled();
      },
    );
  });

  describe("when the Project is not linked", () => {
    it("ends the run when its questions go unanswered", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ code: "EEXIT" });
    });

    it("asks for what the Project is missing", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(asked()).not.toEqual([]);
    });

    it("asks for that before the connection's own settings", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(asked()).not.toContain(QUESTION.slug);
    });
  });

  describe("when a connection file of an unlinked Project is not valid JSON", () => {
    it("refuses it as a validation failure", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/idps/broken.json"), "{ not json");

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing, not even to link the Project", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/idps/broken.json"), "{ not json");

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("when the login flow has errors", () => {
    /**
     * The login flow with its entry step sent to a step that does not exist.
     */
    const BROKEN_FLOW = withStep(loginFlow("default-human-user"), "identifier", (step) => {
      return { ...step, transitions: { submit: { target: "nowhere" } } };
    });

    it("refuses it as a validation failure", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { "default-human-user": defaultSchema },
        flows: { "default-human-user-login": BROKEN_FLOW },
        linked: true,
      });
      typing(ACME.slug);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { "default-human-user": defaultSchema },
        flows: { "default-human-user-login": BROKEN_FLOW },
        linked: true,
      });
      typing(ACME.slug);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(asked()).toEqual([QUESTION.slug]);
    });
  });

  describe("when another connection already holds the typed slug's file name", () => {
    it("refuses it as a conflict", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeJson(cwd, ACME.file, ANOTHER_CONNECTION);
      typing(ACME.slug);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.conflict } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeJson(cwd, ACME.file, ANOTHER_CONNECTION);
      typing(ACME.slug);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(asked()).toEqual([QUESTION.slug]);
    });
  });

  describe("with --dry-run at a terminal", () => {
    it("refuses settings the flags left out, since a dry run never asks", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--dry-run"));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--dry-run"));
      });

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("with the connection on disk", () => {
    it("asks for the slug first", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      typingTheSlugThenTheClientId();

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(asked()[0]).toBe(QUESTION.slug);
    });

    it.for([
      ["display name", QUESTION.displayName],
      ["issuer", QUESTION.issuer],
      ["scopes", QUESTION.scopes],
    ] as const)("does not ask for the %s the file holds", async ([_, question], { dir }) => {
      const cwd = await aProjectWithAcme(dir);
      typingTheSlugThenTheClientId();

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(asked()).not.toContain(question);
    });

    it("writes no other connection file", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      typingTheSlugThenTheClientId();

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["acme-sso.json"]);
    });

    it("leaves the connection as it was", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      const before = await readJson(cwd, ACME.file);
      typingTheSlugThenTheClientId();

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(await readJson(cwd, ACME.file)).toEqual(before);
    });

    it("finds it in a file named differently from its slug", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      await writeJson(cwd, ".zitadel/idps/renamed.json", await readJson(cwd, ACME.file));
      await rm(join(cwd, ACME.file));
      typingTheSlugThenTheClientId();

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["renamed.json"]);
    });

    it("does not ask for a stored value that cannot be used when a flag replaces it", async ({
      dir,
    }) => {
      const cwd = await aProjectWithAcme(dir, { display_name: "   " });
      typing(ACME.slug, ACME.clientId);

      await AuthMethodSsoEnable.run(customArgs(cwd, "--display-name", ACME.displayName));

      expect(asked()).not.toContain(QUESTION.displayName);
    });

    it("does not ask for stored scopes the rules refuse, since reuse never applies them", async ({
      dir,
    }) => {
      const cwd = await aProjectWithAcme(dir, { oidc: { scopes: ["profile"] } });
      typingTheSlugThenTheClientId();

      await AuthMethodSsoEnable.run(customArgs(cwd));

      expect(asked()).not.toContain(QUESTION.scopes);
    });
  });

  describe.each([
    ["a display name that cannot be used", { display_name: "   " }, EXIT.validation],
    ["no issuer, whatever would be typed", { oidc: undefined }, EXIT.conflict],
  ])("with a connection on disk holding %s", (_, overrides, exit) => {
    it("refuses it", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, overrides);
      typing(ACME.slug);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, overrides);
      typing(ACME.slug);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(asked()).toEqual([QUESTION.slug]);
    });
  });

  describe("with a connection on disk whose issuer the connection contract refuses", () => {
    it("refuses the project as not valid", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, { oidc: { issuer: "not a url" } });
      typing(ACME.slug);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, { oidc: { issuer: "not a url" } });
      typing(ACME.slug);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd));
      });

      expect(text).not.toHaveBeenCalled();
    });
  });

  describe("with an --issuer other than the one the connection on disk holds", () => {
    it("refuses it as a conflict", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      typing(ACME.slug);

      const error = await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--issuer", "https://elsewhere.example"));
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: EXIT.conflict } });
    });

    it("refuses it before asking anything after the slug", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      typing(ACME.slug);

      await rejectionOf(() => {
        return AuthMethodSsoEnable.run(customArgs(cwd, "--issuer", "https://elsewhere.example"));
      });

      expect(asked()).toEqual([QUESTION.slug]);
    });
  });

  describe("with attributes the connection does not map", () => {
    it.for([
      [
        "an optional one",
        { favouriteColour: { type: "string" } },
        [],
        "- favouriteColour is optional, so it can stay empty.",
      ],
      [
        "a required one",
        { companyName: { type: "string" } },
        ["companyName"],
        "- companyName is required, so sign-up will have to ask for it.",
      ],
      [
        "an object whose members are required",
        {
          address: {
            type: "object",
            properties: { street: { type: "string" } },
            required: ["street"],
          },
        },
        ["address"],
        "- address is required, so sign-up will have to ask for it.",
      ],
    ] as const)("lists %s", async ([, properties, required, line], { dir }) => {
      const cwd = await setUpProject(dir, {
        "default-human-user": aSchemaWith(properties, [...required]),
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).toContain(line);
    });

    it("says a required one is not filled when the connection creates no users", async ({
      dir,
    }) => {
      const cwd = await setUpProject(dir, {
        "default-human-user": aSchemaWith({ companyName: { type: "string" } }, ["companyName"]),
      });
      await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });
      await writeJson(cwd, ACME.file, {
        ...(await readJson(cwd, ACME.file)),
        provisioning: { creation: "disabled" },
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).toContain(
        "- companyName is required, but this connection does not create users.",
      );
      expect(result.stdout).toContain(
        "Acme SSO does not create users in Zitadel, so these claims are not used to fill one:",
      );
    });
  });

  describe("with a connection file edited by hand", () => {
    it("says a verification that always holds is always trusted", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      await writeJson(cwd, ACME.file, {
        ...(await readJson(cwd, ACME.file)),
        verified_claims: { email: true },
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).toContain("It always counts as");
    });

    it("says a mapped attribute nothing verifies is not verified", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      await writeJson(cwd, ACME.file, {
        ...(await readJson(cwd, ACME.file)),
        verified_claims: {},
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).toContain("It is not treated as");
    });

    it("draws no mapping lines for a connection that maps nothing", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      await writeJson(cwd, ACME.file, {
        ...(await readJson(cwd, ACME.file)),
        claim_mapping: {},
        verified_claims: {},
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).not.toContain("fills in their new user like this");
    });

    it("prints a claim name holding a newline on one line", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      await writeJson(cwd, ACME.file, {
        ...(await readJson(cwd, ACME.file)),
        claim_mapping: { email: "mail\n- password (required) - injected" },
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).toContain("mail\\x0a-");
    });
  });

  describe("with a name that carries a control character", () => {
    it("prints an attribute name as text in the summary", async ({ dir }) => {
      const cwd = await setUpProject(dir, {
        "default-human-user": aSchemaWith({ "nick\u001b[2Jname": { type: "string" } }),
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodText(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(result.stdout).toContain("- nick\\x1b[2Jname is optional");
    });

    it("prints a display name as text in the title", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(
          authMethodText(
            cwd,
            ...CUSTOM,
            "--slug",
            ACME.slug,
            "--display-name",
            "Evil\u001b[2J SSO",
            "--issuer",
            ACME.issuer,
            "--client-id",
            ACME.clientId,
          ),
        );
      });

      expect(result.stdout).toContain("signs in with Evil\\x1b[2J SSO");
    });
  });

  describe("with --provider custom and --json --dry-run", () => {
    it("reports what the connection would map", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodJson(cwd, ...CUSTOM, ...ACME_FLAGS, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          connection: {
            claim_mapping: { email: "email" },
            scopes: ["openid", "profile", "email"],
            used_by: ["default-human-user"],
          },
        },
      });
    });
  });

  describe("with --provider custom and --json", () => {
    it("reports what the connection maps and who signs in through it", async ({ dir }) => {
      const cwd = await setUpProject(dir, {
        "default-human-user": aSchemaWith({ favouriteColour: { type: "string" } }),
      });

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(authMethodJson(cwd, ...CUSTOM, ...ACME_FLAGS));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          connection: {
            claim_mapping: { email: "email" },
            verified_claims: { email: "email_verified" },
            scopes: ["openid", "profile", "email"],
            unmapped: [{ property: "favouriteColour", required: false }],
            used_by: ["default-human-user"],
          },
        },
      });
    });
  });

  describe("with --provider custom in a script", () => {
    it.for([
      "When someone signs in with Acme SSO for the first time, Zitadel fills in their new user",
      "- email comes from the provider's email claim.",
      "It counts as verified",
      "email_verified is true.",
      "Zitadel asks Acme SSO for these scopes: openid, profile, and email.",
      "This connection is used by default-human-user",
      "To change which claim fills an attribute, edit claim_mapping in",
      ".zitadel/idps/acme-sso.json and run deploy.",
    ])("says %s", async (line, { dir }) => {
      const cwd = await setUpProject(dir);

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(
          authMethodText(
            cwd,
            ...CUSTOM,
            "--slug",
            ACME.slug,
            "--display-name",
            ACME.displayName,
            "--issuer",
            ACME.issuer,
            "--client-id",
            ACME.clientId,
          ),
        );
      });

      expect(result.stdout).toContain(line);
    });

    it("prints its notice after writing the file it describes", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const result = await withStdin(ACME.secret, () => {
        return runCliForTest(
          authMethodText(
            cwd,
            ...CUSTOM,
            "--slug",
            ACME.slug,
            "--display-name",
            ACME.displayName,
            "--issuer",
            ACME.issuer,
            "--client-id",
            ACME.clientId,
          ),
        );
      });

      expect(result.stdout.indexOf("When someone signs in with Acme SSO")).toBeGreaterThan(
        result.stdout.indexOf(`Wrote ${ACME.file}`),
      );
    });

    it("stops with the flags it needs under --json", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const result = await runCliForTest(["auth-method", ...SLUG_ONLY, "--cwd", cwd, "--json"]);

      expect(parseJson(result.stdout)).toMatchObject({
        status: "error",
        code: "E_VALIDATION",
        message: MISSING,
      });
    });

    it("stops with the flags it needs under --non-interactive", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const result = await runCliForTest(authMethodText(cwd, ...SLUG_ONLY));

      expect(result).toMatchObject({
        exitCode: EXIT.validation,
        stderr: expect.stringContaining(MISSING),
      });
    });

    it("names a mistake in the flags before the environment's missing issuer", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { "default-human-user": defaultSchema },
        flows: { "default-human-user-login": loginFlow("default-human-user") },
      });

      const result = await runCliForTest(
        authMethodJson(
          cwd,
          ...CUSTOM,
          "--slug",
          "Not A Slug",
          "--display-name",
          ACME.displayName,
          "--issuer",
          ACME.issuer,
        ),
      );

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        message: expect.not.stringContaining("no development issuer"),
      });
    });
  });
});

describe("auth-method sso enable when the schema cannot be written", () => {
  it("has published the credentials by then, so a rerun is not left reusing a connection without them", async ({
    dir,
  }) => {
    const cwd = await setUpProject(dir);
    const sent: string[] = [];
    server.events.on("request:start", ({ request }) => {
      sent.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    const schemaFile = join(cwd, ".zitadel/schemas/default-human-user.json");
    await chmod(schemaFile, 0o400);
    await chmod(join(cwd, ".zitadel/schemas"), 0o500);
    let failure: unknown;

    try {
      failure = await withStdin(ACME.secret, () => {
        return rejectionOf(() => {
          return AuthMethodSsoEnable.run([
            ...customArgs(cwd),
            "--slug",
            ACME.slug,
            "--display-name",
            ACME.displayName,
            "--issuer",
            ACME.issuer,
            "--client-id",
            ACME.clientId,
          ]);
        });
      });
    } finally {
      await chmod(join(cwd, ".zitadel/schemas"), 0o700);
      await chmod(schemaFile, 0o600);
      server.events.removeAllListeners();
    }

    expect(failure).toMatchObject({ code: "EEXIT", oclif: { exit: 1 } });
    expect(
      sent.filter((call) => {
        return call.includes("/variables");
      }),
    ).not.toEqual([]);
  });
});

describe("AuthMethodSsoEnable.flags", () => {
  it.each([
    ["slug", AuthMethodSsoEnable.flags.slug, "Acme SSO"],
    ["display-name", AuthMethodSsoEnable.flags["display-name"], ""],
    ["issuer", AuthMethodSsoEnable.flags.issuer, "not a url"],
    ["scopes", AuthMethodSsoEnable.flags.scopes, "profile"],
  ])("refuses what --%s cannot carry, naming that flag", async (name, flag, value) => {
    const error = await rejectionOf(() => {
      return parseFlag(flag, value, name);
    });

    expect(error).toBeInstanceOf(ZitadelError);
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining(`--${name}`),
    });
  });

  it.each([
    ["slug", AuthMethodSsoEnable.flags.slug, "acme-sso"],
    ["display-name", AuthMethodSsoEnable.flags["display-name"], "Acme SSO"],
    ["issuer", AuthMethodSsoEnable.flags.issuer, "https://sso.acme.example"],
    ["scopes", AuthMethodSsoEnable.flags.scopes, "openid profile"],
  ])("takes what --%s can, trimmed", async (name, flag, value) => {
    const parsed = await parseFlag(flag, ` ${value} `, name);

    expect(parsed).toBe(value);
  });
});
