import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import AuthMethodSsoEnable from "@/commands/auth-method/sso/enable";
import {
  defaultSchema,
  loginFlow,
  makeProject,
  readJson,
  setUpProject,
  withStdin,
  writeJson,
} from "@tests/helpers/local-project";
import { parseFlag } from "@tests/helpers/inputs";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { parseJson, runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { asOneLine, asTerminalTyping } from "@tests/helpers/terminal";

// The questions are plain lines read from the process's own streams, which only
// a run from source can be given, so the command is run here rather than built.
usePlatformServer();

const ACME = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
  scopes: "openid profile email",
};

/**
 * `auth-method sso enable --provider custom` run by a person at a terminal who
 * types `answers` in the order the questions come. A run that is refused does
 * not throw out of here: its failure is handed back beside everything the
 * person was shown, so a test can say what had been asked before the refusal.
 */
async function enableCustom(cwd: string, answers: readonly string[], ...extra: string[]) {
  let failure: unknown;
  const { shown } = await asTerminalTyping(answers, async () => {
    try {
      await AuthMethodSsoEnable.run(["--cwd", cwd, "--provider", "custom", ...extra]);
    } catch (error) {
      failure = error;
    }
  });
  return { failure, shown: stripAnsi(shown) };
}

/** The questions the custom connection asks, as a person reads them. */
const QUESTION = {
  slug: "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
  displayName: "What name should the sign-in button show? For example Acme SSO.",
  issuer: "What is the issuer URL of the provider?",
  scopes: "Which scopes should we request? Separate them with spaces.",
  clientId: "What is the client ID of your Acme SSO OAuth app?",
  secret:
    "What is the client secret of your Acme SSO OAuth app? It will be stored on the project as ACME_SSO_CLIENT_SECRET.",
};

/** Every one of those questions that `shown` holds, in the order it was asked. */
function asked(shown: string): string[] {
  return Object.values(QUESTION)
    .map((question) => ({ question, at: shown.indexOf(question) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(({ question }) => question);
}

/** Exit codes: 3 is a validation failure, 4 not found or unreachable, 5 a conflict. */
const exitsWith = (code: number) => ({ oclif: { exit: code } });

describe("auth-method sso enable --provider custom on a terminal", () => {
  it("asks for the connection's settings, then for its credentials", async () => {
    const cwd = await setUpProject();

    const { failure, shown } = await enableCustom(cwd, [
      ACME.slug,
      ACME.displayName,
      ACME.issuer,
      "openid email",
      "acme-client-id",
      "acme-secret",
    ]);

    expect(failure).toBeUndefined();
    expect(asked(shown)).toEqual([
      QUESTION.slug,
      QUESTION.displayName,
      QUESTION.issuer,
      QUESTION.scopes,
      QUESTION.clientId,
      QUESTION.secret,
    ]);
    expect(await readJson(cwd, ".zitadel/idps/acme-sso.json")).toMatchObject({
      display_name: ACME.displayName,
      oidc: { issuer: ACME.issuer, scopes: ["openid", "email"] },
    });
  });

  it("asks only for what the flags left out", async () => {
    const cwd = await setUpProject();

    const { failure, shown } = await enableCustom(
      cwd,
      [ACME.displayName, ACME.scopes, "acme-client-id", "acme-secret"],
      "--slug",
      ACME.slug,
      "--issuer",
      ACME.issuer,
    );

    expect(failure).toBeUndefined();
    expect(asked(shown)).toEqual([
      QUESTION.displayName,
      QUESTION.scopes,
      QUESTION.clientId,
      QUESTION.secret,
    ]);
    await expect(readFile(join(cwd, ".zitadel/idps/acme-sso.json"), "utf8")).resolves.toContain(
      "https://sso.acme.example",
    );
  });

  it("names a mistake in a given flag before asking anything", async () => {
    const cwd = await setUpProject();

    // The slug is not given, so it would be the first question; the bad issuer
    // is refused before that question, under its flag. Exit code 3 is the
    // CLI's validation failure.
    const { failure, shown } = await enableCustom(cwd, [], "--issuer", "not a url");

    expect(failure).toMatchObject({ oclif: { exit: 3 } });
    expect(asked(shown)).toEqual([]);
  });

  it("refuses a typed slug that names a provider, and asks again", async () => {
    const cwd = await setUpProject();

    const { failure, shown } = await enableCustom(cwd, ["google"]);

    // The plain question refuses the answer where it is typed and asks again;
    // with nobody left to answer, the person has walked away.
    expect(failure).toMatchObject({ oclif: { exit: 130 } });
    expect(shown).toContain('"google" is a built-in provider. Choose another name');
    expect(shown.split(QUESTION.slug)).toHaveLength(3);
  });

  it("asks only for the credentials when every setting was given", async () => {
    const cwd = await setUpProject();

    const { failure, shown } = await enableCustom(
      cwd,
      ["acme-client-id", "acme-secret"],
      "--slug",
      ACME.slug,
      "--display-name",
      ACME.displayName,
      "--issuer",
      ACME.issuer,
      "--scopes",
      ACME.scopes,
    );

    expect(failure).toBeUndefined();
    expect(asked(shown)).toEqual([QUESTION.clientId, QUESTION.secret]);
  });

  it("asks nothing when the schema does not exist, so nobody answers for nothing", async () => {
    const cwd = await setUpProject();

    // Exit code 4 is the CLI's not-found failure.
    const { failure, shown } = await enableCustom(cwd, [], "--schema", "nope");

    expect(failure).toMatchObject({ oclif: { exit: 4 } });
    expect(asked(shown)).toEqual([]);
  });
});

describe("auth-method sso enable --provider custom after it writes a connection", () => {
  it("explains the claim mappings it wrote", async () => {
    const cwd = await setUpProject();

    const result = await withStdin("piped-secret", () =>
      runCliForTest([
        "auth-method",
        "sso",
        "enable",
        "--cwd",
        cwd,
        "--non-interactive",
        "--provider",
        "custom",
        "--slug",
        "acme-sso",
        "--display-name",
        "Acme SSO",
        "--issuer",
        "https://sso.acme.example",
        "--client-id",
        "acme-client-id",
      ]),
    );

    const output = asOneLine(result.stdout);
    expect(output).toContain("Claim mappings in .zitadel/idps/acme-sso.json.");
    expect(output).toContain("email ← email");
    expect(output).toContain("Verification, which a mapping alone does not give:");
    expect(output).toContain(
      "email is treated as verified only when Acme SSO says so in the email_verified claim.",
    );
    expect(output).toContain(
      "Edit the mappings in that file if your provider returns other claims.",
    );
    // After the file it describes was written, not before.
    expect(output.indexOf("Claim mappings in")).toBeGreaterThan(
      output.indexOf("Wrote .zitadel/idps/acme-sso.json"),
    );
  });
});

/** Create the acme-sso connection the way a script does, then forget the prompts. */
async function withAcmeConnection(cwd: string): Promise<void> {
  await withStdin("acme-secret", () =>
    runCliForTest([
      "auth-method",
      "sso",
      "enable",
      "--cwd",
      cwd,
      "--non-interactive",
      "--provider",
      "custom",
      "--slug",
      ACME.slug,
      "--display-name",
      ACME.displayName,
      "--issuer",
      ACME.issuer,
      "--client-id",
      "acme-client-id",
    ]),
  );
}

describe("each setting a custom connection is described by", () => {
  it.each([
    ["slug", "Acme SSO"],
    ["display-name", ""],
    ["issuer", "not a url"],
    ["scopes", "profile"],
  ])("refuses what --%s cannot carry, naming that flag", async (name, value) => {
    const flag = AuthMethodSsoEnable.flags[name as "slug"];

    await expect(parseFlag(flag, value, name)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining(`--${name}`),
    });
  });

  it.each([
    ["slug", "acme-sso"],
    ["display-name", "Acme SSO"],
    ["issuer", "https://sso.acme.example"],
    ["scopes", "openid profile"],
  ])("takes what --%s can, trimmed", async (name, value) => {
    const flag = AuthMethodSsoEnable.flags[name as "slug"];

    await expect(parseFlag(flag, ` ${value} `, name)).resolves.toBe(value);
  });
});

describe("auth-method sso enable --provider custom refuses before it asks", () => {
  it("when no login flow runs against the schema, even before the Project is connected", async () => {
    // Not linked, so `connect()` would ask for the server, project and token.
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: { elsewhere: loginFlow("another-schema") },
    });
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");

    const { failure, shown } = await enableCustom(cwd, []);

    expect(failure).toMatchObject(exitsWith(4));
    expect(asked(shown)).toEqual([]);
  });

  it("when the Project is not connected, which asks for what it is missing first", async () => {
    // The issuer is known, so the flags pass; the Project's server, id and
    // secret are missing, which `connect()` asks for before anything else, so
    // the connection's own questions must not have come before it.
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: { "default-human-user-login": loginFlow("default-human-user") },
    });
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");

    const { failure, shown } = await enableCustom(cwd, []);

    expect(failure).toMatchObject({ code: "EEXIT" });
    expect(shown).not.toBe("");
    expect(asked(shown)).not.toContain(QUESTION.slug);
  });

  it("when a connection file is not valid JSON, even before the Project is connected", async () => {
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: { "default-human-user-login": loginFlow("default-human-user") },
    });
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/idps/broken.json"), "{ not json");

    const { failure, shown } = await enableCustom(cwd, []);

    expect(failure).toMatchObject(exitsWith(3));
    expect(asked(shown)).toEqual([]);
  });

  it("when a login flow has errors, as soon as the slug is typed", async () => {
    const flow = loginFlow("default-human-user");
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: {
        "default-human-user-login": {
          ...flow,
          steps: flow.steps.map((step) =>
            step.name === "identifier"
              ? { ...step, transitions: { submit: { target: "nowhere" } } }
              : step,
          ),
        },
      },
      linked: true,
    });

    const { failure, shown } = await enableCustom(cwd, [ACME.slug]);

    expect(failure).toMatchObject(exitsWith(3));
    expect(asked(shown)).toEqual([QUESTION.slug]);
  });

  it("when the slug is typed and another file already occupies its file name", async () => {
    const cwd = await setUpProject();
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { slug: "something-else" });

    const { failure, shown } = await enableCustom(cwd, [ACME.slug]);

    expect(failure).toMatchObject(exitsWith(5));
    expect(asked(shown)).toEqual([QUESTION.slug]);
  });

  it("on a dry run, which never asks, so the flags must say everything", async () => {
    const cwd = await setUpProject();

    const { failure, shown } = await enableCustom(cwd, [], "--dry-run");

    expect(failure).toMatchObject(exitsWith(3));
    expect(asked(shown)).toEqual([]);
  });
});

describe("auth-method sso enable --provider custom for a connection that exists", () => {
  it("asks for the slug, then reuses the file without asking for what it holds", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const before = await readJson(cwd, ".zitadel/idps/acme-sso.json");

    const { failure, shown } = await enableCustom(cwd, [
      ACME.slug,
      "acme-client-id",
      "acme-secret",
    ]);

    expect(failure).toBeUndefined();
    expect(asked(shown)[0]).toBe(QUESTION.slug);
    expect(asked(shown)).not.toContain(QUESTION.displayName);
    expect(asked(shown)).not.toContain(QUESTION.issuer);
    expect(asked(shown)).not.toContain(QUESTION.scopes);
    expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["acme-sso.json"]);
    expect(await readJson(cwd, ".zitadel/idps/acme-sso.json")).toEqual(before);
  });

  it("refuses a file that holds a setting that cannot be used", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, display_name: "   " });

    const { failure, shown } = await enableCustom(cwd, [ACME.slug]);

    expect(failure).toMatchObject(exitsWith(3));
    expect(asked(shown)).toEqual([QUESTION.slug]);
  });

  it("refuses a file that has no issuer, whatever would be typed", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, oidc: {} });

    const { failure, shown } = await enableCustom(cwd, [ACME.slug]);

    expect(failure).toMatchObject(exitsWith(5));
    expect(asked(shown)).toEqual([QUESTION.slug]);
  });
});

describe("auth-method sso enable --provider custom against what a connection holds", () => {
  it("refuses an issuer flag that differs from the connection's before asking anything else", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    // Without a stored display name that question would come next, so the
    // refusal must come first, as soon as the slug is typed.
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, display_name: undefined });

    const { failure, shown } = await enableCustom(
      cwd,
      [ACME.slug, ACME.displayName],
      "--issuer",
      "https://elsewhere.example",
    );

    expect(failure).toMatchObject(exitsWith(5));
    expect(asked(shown)).toEqual([QUESTION.slug]);
  });

  it("does not read a stored value that a flag replaces", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, display_name: "   " });

    const { failure, shown } = await enableCustom(
      cwd,
      [ACME.slug, "acme-client-id", "acme-secret"],
      "--display-name",
      ACME.displayName,
    );

    expect(failure).toBeUndefined();
    expect(asked(shown)).not.toContain(QUESTION.displayName);
  });

  it("does not hold a stored scope list to the rules, since reuse never applies it", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", {
      ...file,
      oidc: { ...(file.oidc as object), scopes: ["profile"] },
    });

    const { failure, shown } = await enableCustom(cwd, [
      ACME.slug,
      "acme-client-id",
      "acme-secret",
    ]);

    expect(failure).toBeUndefined();
    expect(asked(shown)).not.toContain(QUESTION.scopes);
  });

  it("refuses a stored issuer that cannot be used", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, oidc: { issuer: "not a url" } });

    const { failure, shown } = await enableCustom(cwd, [ACME.slug]);

    expect(failure).toMatchObject(exitsWith(3));
    expect(asked(shown)).toEqual([QUESTION.slug]);
  });

  it("finds a connection whose file is named differently from its slug", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/renamed.json", file);
    await rm(join(cwd, ".zitadel/idps/acme-sso.json"));

    const { failure } = await enableCustom(cwd, [ACME.slug, "acme-client-id", "acme-secret"]);

    expect(failure).toBeUndefined();
    expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["renamed.json"]);
  });
});

describe("auth-method sso enable --provider custom in a script", () => {
  const partial = (cwd: string, ...mode: string[]) =>
    runCliForTest([
      "auth-method",
      "sso",
      "enable",
      "--cwd",
      cwd,
      ...mode,
      "--provider",
      "custom",
      "--slug",
      ACME.slug,
    ]);
  const MISSING = "A custom connection needs --display-name, --issuer";

  it("still stops with the flags it needs under --json", async () => {
    const cwd = await setUpProject();

    const result = await partial(cwd, "--json");

    expect(parseJson(result.stdout)).toMatchObject({
      status: "error",
      code: "E_VALIDATION",
      message: MISSING,
    });
  });

  it("still stops with the flags it needs under --non-interactive", async () => {
    const cwd = await setUpProject();

    const result = await partial(cwd, "--non-interactive");

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain(MISSING);
  });

  it("names a mistake in the flags before it names the missing issuer of the environment", async () => {
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: { "default-human-user-login": loginFlow("default-human-user") },
    });

    const result = await runCliForTest([
      "auth-method",
      "sso",
      "enable",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
      "--provider",
      "custom",
      "--slug",
      "Not A Slug",
      "--display-name",
      ACME.displayName,
      "--issuer",
      ACME.issuer,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({ code: "E_VALIDATION" });
    expect((parseJson(result.stdout) as { message: string }).message).not.toContain(
      "no development issuer",
    );
  });
});
