import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Errors } from "@oclif/core";
import { describe, expect } from "vitest";

import AuthMethodSsoEnable from "@/commands/auth-method/sso/enable";
import { ZitadelError } from "@/lib/errors";
import type { JsonObject } from "@/lib/zitadel";
import { authMethodJson, authMethodText } from "@tests/helpers/auth-method";
import { anOidcConnection, type DocumentsByName } from "@tests/helpers/config";
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
import { parseJson, runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { asOneLine, asTerminalTyping } from "@tests/helpers/terminal";
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
 * A connection under another slug, written at the file {@link ACME}'s slug names.
 */
const ANOTHER_CONNECTION = anOidcConnection({ slug: "something-else" });

/**
 * The questions the command asks a person for a custom connection, as a person
 * reads them.
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
const EXIT = { validation: 3, notFound: 4, conflict: 5, interrupted: 130 } as const;

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
 * What the person types for a connection that is already on disk: its slug,
 * then the client id and the client secret.
 */
const SLUG_AND_CREDENTIALS = [ACME.slug, ACME.clientId, ACME.secret] as const;

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
 * `auth-method sso enable --provider custom` run by a person at a terminal who
 * types `answers` in the order the questions come. A run that is refused does
 * not throw out of here: its failure is handed back beside everything the
 * person was shown, so a test can say what had been asked before the refusal.
 *
 * @param cwd - The Project.
 * @param answers - What the person types, one answer to each question.
 * @param flags - The flags the person typed.
 * @returns The failure, when the run was refused, and what the person was shown.
 */
async function enterCustom(
  cwd: string,
  answers: readonly string[],
  ...flags: string[]
): Promise<{ failure: unknown; shown: string }> {
  let failure: unknown;
  const { shown } = await asTerminalTyping(answers, async () => {
    failure = await rejectionOf(() => {
      return AuthMethodSsoEnable.run(customArgs(cwd, ...flags));
    });
  });
  return { failure, shown: stripAnsi(shown) };
}

/**
 * Every question `shown` holds, in the order it was asked and each once.
 *
 * @param shown - Everything the person was shown.
 * @returns The questions.
 */
function asked(shown: string): string[] {
  return Object.values(QUESTION)
    .map((question) => {
      return { question, at: shown.indexOf(question) };
    })
    .filter(({ at }) => {
      return at >= 0;
    })
    .sort((a, b) => {
      return a.at - b.at;
    })
    .map(({ question }) => {
      return question;
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

describe("auth-method sso enable", () => {
  describe("with --provider custom at a terminal", () => {
    it("asks for the connection's settings, then for its credentials", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, [
        ACME.slug,
        ACME.displayName,
        ACME.issuer,
        "openid email",
        ACME.clientId,
        ACME.secret,
      ]);

      expect(asked(shown)).toEqual([
        QUESTION.slug,
        QUESTION.displayName,
        QUESTION.issuer,
        QUESTION.scopes,
        QUESTION.clientId,
        QUESTION.secret,
      ]);
    });

    it("writes the settings the person typed", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      await enterCustom(cwd, [
        ACME.slug,
        ACME.displayName,
        ACME.issuer,
        "openid email",
        ACME.clientId,
        ACME.secret,
      ]);

      expect(await readJson(cwd, ACME.file)).toMatchObject({
        display_name: ACME.displayName,
        oidc: { issuer: ACME.issuer, scopes: ["openid", "email"] },
      });
    });

    it("asks only for what the flags left out", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(
        cwd,
        [ACME.displayName, ACME.scopes, ACME.clientId, ACME.secret],
        "--slug",
        ACME.slug,
        "--issuer",
        ACME.issuer,
      );

      expect(asked(shown)).toEqual([
        QUESTION.displayName,
        QUESTION.scopes,
        QUESTION.clientId,
        QUESTION.secret,
      ]);
    });

    it("writes the issuer a flag gave", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      await enterCustom(
        cwd,
        [ACME.displayName, ACME.scopes, ACME.clientId, ACME.secret],
        "--slug",
        ACME.slug,
        "--issuer",
        ACME.issuer,
      );

      expect(await readJson(cwd, ACME.file)).toMatchObject({ oidc: { issuer: ACME.issuer } });
    });

    it("asks only for the credentials when the flags gave every setting", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(
        cwd,
        [ACME.clientId, ACME.secret],
        "--slug",
        ACME.slug,
        "--display-name",
        ACME.displayName,
        "--issuer",
        ACME.issuer,
        "--scopes",
        ACME.scopes,
      );

      expect(asked(shown)).toEqual([QUESTION.clientId, QUESTION.secret]);
    });
  });

  describe("with a bad --issuer and the slug left to ask for", () => {
    it("refuses the flag as a validation failure", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { failure } = await enterCustom(cwd, [], "--issuer", "not a url");

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing first", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, [], "--issuer", "not a url");

      expect(asked(shown)).toEqual([]);
    });
  });

  describe("when the typed slug names a provider", () => {
    it("refuses the name where it is typed", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, ["google"]);

      expect(shown).toContain('"google" is a built-in provider. Choose another name');
    });

    it("asks for the slug again", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, ["google"]);

      expect(shown.split(QUESTION.slug)).toHaveLength(3);
    });

    it("ends the run when nobody answers again", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { failure } = await enterCustom(cwd, ["google"]);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.interrupted } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, ["google"]);

      expect(asked(shown)).toEqual([QUESTION.slug]);
    });
  });

  describe("when the schema does not exist", () => {
    it("refuses it as not found", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { failure } = await enterCustom(cwd, [], "--schema", "nope");

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.notFound } });
    });

    it("asks no question, so nobody answers for nothing", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, [], "--schema", "nope");

      expect(asked(shown)).toEqual([]);
    });
  });

  describe("when no login flow runs against the schema of an unlinked Project", () => {
    it("refuses it as not found", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, { elsewhere: loginFlow("another-schema") });

      const { failure } = await enterCustom(cwd, []);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.notFound } });
    });

    it("asks nothing, not even to link the Project", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, { elsewhere: loginFlow("another-schema") });

      const { shown } = await enterCustom(cwd, []);

      expect(shown).toBe("");
    });
  });

  describe("when the Project is not linked", () => {
    it("ends the run when its questions go unanswered", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });

      const { failure } = await enterCustom(cwd, []);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ code: "EEXIT" });
    });

    it("asks for what the Project is missing", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });

      const { shown } = await enterCustom(cwd, []);

      expect(shown).not.toBe("");
    });

    it("asks for that before the connection's own settings", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });

      const { shown } = await enterCustom(cwd, []);

      expect(asked(shown)).not.toContain(QUESTION.slug);
    });
  });

  describe("when a connection file of an unlinked Project is not valid JSON", () => {
    it("refuses it as a validation failure", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/idps/broken.json"), "{ not json");

      const { failure } = await enterCustom(cwd, []);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing, not even to link the Project", async ({ dir }) => {
      const cwd = await anUnlinkedProject(dir, {
        "default-human-user-login": loginFlow("default-human-user"),
      });
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/idps/broken.json"), "{ not json");

      const { shown } = await enterCustom(cwd, []);

      expect(shown).toBe("");
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

      const { failure } = await enterCustom(cwd, [ACME.slug]);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { "default-human-user": defaultSchema },
        flows: { "default-human-user-login": BROKEN_FLOW },
        linked: true,
      });

      const { shown } = await enterCustom(cwd, [ACME.slug]);

      expect(asked(shown)).toEqual([QUESTION.slug]);
    });
  });

  describe("when another connection already holds the typed slug's file name", () => {
    it("refuses it as a conflict", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeJson(cwd, ACME.file, ANOTHER_CONNECTION);

      const { failure } = await enterCustom(cwd, [ACME.slug]);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.conflict } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await setUpProject(dir);
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeJson(cwd, ACME.file, ANOTHER_CONNECTION);

      const { shown } = await enterCustom(cwd, [ACME.slug]);

      expect(asked(shown)).toEqual([QUESTION.slug]);
    });
  });

  describe("with --dry-run at a terminal", () => {
    it("refuses settings the flags left out, since a dry run never asks", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { failure } = await enterCustom(cwd, [], "--dry-run");

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const { shown } = await enterCustom(cwd, [], "--dry-run");

      expect(asked(shown)).toEqual([]);
    });
  });

  describe("with the connection on disk", () => {
    it("asks for the slug first", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);

      const { shown } = await enterCustom(cwd, SLUG_AND_CREDENTIALS);

      expect(asked(shown)[0]).toBe(QUESTION.slug);
    });

    it.for([
      ["display name", QUESTION.displayName],
      ["issuer", QUESTION.issuer],
      ["scopes", QUESTION.scopes],
    ] as const)("does not ask for the %s the file holds", async ([_, question], { dir }) => {
      const cwd = await aProjectWithAcme(dir);

      const { shown } = await enterCustom(cwd, SLUG_AND_CREDENTIALS);

      expect(asked(shown)).not.toContain(question);
    });

    it("writes no other connection file", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);

      await enterCustom(cwd, SLUG_AND_CREDENTIALS);

      expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["acme-sso.json"]);
    });

    it("leaves the connection as it was", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      const before = await readJson(cwd, ACME.file);

      await enterCustom(cwd, SLUG_AND_CREDENTIALS);

      expect(await readJson(cwd, ACME.file)).toEqual(before);
    });

    it("finds it in a file named differently from its slug", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);
      await writeJson(cwd, ".zitadel/idps/renamed.json", await readJson(cwd, ACME.file));
      await rm(join(cwd, ACME.file));

      await enterCustom(cwd, SLUG_AND_CREDENTIALS);

      expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["renamed.json"]);
    });

    it("does not ask for a stored value that cannot be used when a flag replaces it", async ({
      dir,
    }) => {
      const cwd = await aProjectWithAcme(dir, { display_name: "   " });

      const { shown } = await enterCustom(
        cwd,
        SLUG_AND_CREDENTIALS,
        "--display-name",
        ACME.displayName,
      );

      expect(asked(shown)).not.toContain(QUESTION.displayName);
    });

    it("does not ask for stored scopes the rules refuse, since reuse never applies them", async ({
      dir,
    }) => {
      const cwd = await aProjectWithAcme(dir, { oidc: { scopes: ["profile"] } });

      const { shown } = await enterCustom(cwd, SLUG_AND_CREDENTIALS);

      expect(asked(shown)).not.toContain(QUESTION.scopes);
    });
  });

  describe.each([
    ["a display name that cannot be used", { display_name: "   " }, EXIT.validation],
    ["no issuer, whatever would be typed", { oidc: undefined }, EXIT.conflict],
  ])("with a connection on disk holding %s", (_, overrides, exit) => {
    it("refuses it", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, overrides);

      const { failure } = await enterCustom(cwd, [ACME.slug]);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit } });
    });

    it("asks nothing after the slug", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, overrides);

      const { shown } = await enterCustom(cwd, [ACME.slug]);

      expect(asked(shown)).toEqual([QUESTION.slug]);
    });
  });

  describe("with a connection on disk whose issuer the connection contract refuses", () => {
    it("refuses the project as not valid", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, { oidc: { issuer: "not a url" } });

      const { failure } = await enterCustom(cwd, [ACME.slug]);

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.validation } });
    });

    it("asks nothing", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir, { oidc: { issuer: "not a url" } });

      const { shown } = await enterCustom(cwd, [ACME.slug]);

      expect(asked(shown)).toEqual([]);
    });
  });

  describe("with an --issuer other than the one the connection on disk holds", () => {
    it("refuses it as a conflict", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);

      const { failure } = await enterCustom(
        cwd,
        [ACME.slug],
        "--issuer",
        "https://elsewhere.example",
      );

      expect(failure).toBeInstanceOf(Errors.ExitError);
      expect(failure).toMatchObject({ oclif: { exit: EXIT.conflict } });
    });

    it("refuses it before asking anything after the slug", async ({ dir }) => {
      const cwd = await aProjectWithAcme(dir);

      const { shown } = await enterCustom(
        cwd,
        [ACME.slug],
        "--issuer",
        "https://elsewhere.example",
      );

      expect(asked(shown)).toEqual([QUESTION.slug]);
    });
  });

  describe("with --provider custom in a script", () => {
    it.for([
      "Claim mappings in .zitadel/idps/acme-sso.json.",
      "email ← email",
      "Verification, which a mapping alone does not give:",
      "email is treated as verified only when Acme SSO says so in the email_verified claim.",
      "Edit the mappings in that file if your provider returns other claims.",
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

      expect(asOneLine(result.stdout)).toContain(line);
    });

    it("explains the claim mappings after writing the file they are in", async ({ dir }) => {
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

      const output = asOneLine(result.stdout);
      expect(output.indexOf("Claim mappings in")).toBeGreaterThan(
        output.indexOf(`Wrote ${ACME.file}`),
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
