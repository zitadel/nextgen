import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../../helpers/clack")).clackDouble());

import { password, text } from "@clack/prompts";

import AuthMethodSsoEnable from "../../../../../src/commands/auth-method/sso/enable";
import {
  defaultSchema,
  loginFlow,
  makeProject,
  readJson,
  setUpProject,
  withStdin,
  writeJson,
} from "../../../../helpers/local-project";
import { parseJson, runCliForTest } from "../../../../helpers/run-cli";
import { asOneLine, asTerminal } from "../../../../helpers/terminal";

// The built CLI bundles its own prompts, so a prompt can only be answered by
// running the command from source, where `input` is the one module asked.
const platform = setupServer(...setupPlatformHandlers());

beforeAll(() => platform.listen({ onUnhandledRequest: "error" }));
afterAll(() => platform.close());
beforeEach(() => {
  vi.mocked(text).mockReset();
  vi.mocked(password).mockReset();
});
afterEach(() => {
  platform.resetHandlers();
  resetPlatformStore();
});

const ACME = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
  scopes: "openid profile email",
};

/** `auth-method sso enable --provider custom` run by a person at a terminal. */
function enableCustom(cwd: string, ...extra: string[]) {
  return asTerminal(() =>
    AuthMethodSsoEnable.run(["--cwd", cwd, "--provider", "custom", ...extra]),
  );
}

/** What the person types, in the order the questions come. */
function typing(...answers: string[]): void {
  for (const answer of answers) {
    vi.mocked(text).mockResolvedValueOnce(answer as never);
  }
  vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);
}

const QUESTION = {
  slug: "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
};

/** Every question asked so far. */
const asked = () => vi.mocked(text).mock.calls.map(([question]) => question.message);

/** Exit codes: 3 is a validation failure, 4 not found or unreachable, 5 a conflict. */
const exitsWith = (code: number) => ({ oclif: { exit: code } });

describe("auth-method sso enable --provider custom on a terminal", () => {
  it("asks for the connection's settings, then for its credentials", async () => {
    const cwd = await setUpProject();
    typing(ACME.slug, ACME.displayName, ACME.issuer, "openid email", "acme-client-id");

    await enableCustom(cwd);

    expect(asked()).toEqual([
      QUESTION.slug,
      "What name should the sign-in button show? For example Acme SSO.",
      "What is the issuer URL of the provider?",
      "Which scopes should we request? Separate them with spaces.",
      "What is the client ID of your Acme SSO OAuth app?",
    ]);
    expect(vi.mocked(password).mock.calls[0]?.[0].message).toBe(
      "What is the client secret of your Acme SSO OAuth app? It will be stored on the project as ACME_SSO_CLIENT_SECRET.",
    );
    expect(await readJson(cwd, ".zitadel/idps/acme-sso.json")).toMatchObject({
      display_name: ACME.displayName,
      oidc: { issuer: ACME.issuer, scopes: ["openid", "email"] },
    });
  });

  it("asks only for what the flags left out", async () => {
    const cwd = await setUpProject();
    typing(ACME.displayName, ACME.scopes, "acme-client-id");

    await enableCustom(cwd, "--slug", ACME.slug, "--issuer", ACME.issuer);

    expect(asked()).toEqual([
      "What name should the sign-in button show? For example Acme SSO.",
      "Which scopes should we request? Separate them with spaces.",
      "What is the client ID of your Acme SSO OAuth app?",
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
    await expect(enableCustom(cwd, "--issuer", "not a url")).rejects.toMatchObject({
      oclif: { exit: 3 },
    });

    expect(text).not.toHaveBeenCalled();
  });

  it("refuses a typed slug that names a provider", async () => {
    const cwd = await setUpProject();
    typing("google");

    await expect(enableCustom(cwd)).rejects.toMatchObject({ oclif: { exit: 3 } });

    expect(asked()).toEqual([QUESTION.slug]);
  });

  it("asks only for the credentials when every setting was given", async () => {
    const cwd = await setUpProject();
    vi.mocked(text).mockResolvedValueOnce("acme-client-id" as never);
    vi.mocked(password).mockResolvedValueOnce("acme-secret" as never);

    await enableCustom(
      cwd,
      "--slug",
      ACME.slug,
      "--display-name",
      ACME.displayName,
      "--issuer",
      ACME.issuer,
      "--scopes",
      ACME.scopes,
    );

    expect(vi.mocked(text).mock.calls.map(([question]) => question.message)).toEqual([
      "What is the client ID of your Acme SSO OAuth app?",
    ]);
  });

  it("asks nothing when the schema does not exist, so nobody answers for nothing", async () => {
    const cwd = await setUpProject();

    // Exit code 4 is the CLI's not-found failure.
    await expect(enableCustom(cwd, "--schema", "nope")).rejects.toMatchObject({
      oclif: { exit: 4 },
    });

    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
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

describe("auth-method sso enable --provider custom refuses before it asks", () => {
  it("when no login flow runs against the schema, even before the Project is connected", async () => {
    // Not linked, so `connect()` would ask for the server, project and token.
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: { elsewhere: loginFlow("another-schema") },
    });
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(4));

    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
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

    await expect(enableCustom(cwd)).rejects.toMatchObject({ code: "EEXIT" });

    expect(asked()).not.toEqual([]);
    expect(asked()).not.toContain(QUESTION.slug);
  });

  it("when a connection file is not valid JSON, even before the Project is connected", async () => {
    const cwd = await makeProject({
      schemas: { "default-human-user": defaultSchema },
      flows: { "default-human-user-login": loginFlow("default-human-user") },
    });
    await writeFile(join(cwd, ".env.local"), "ZITADEL_ISSUER=http://localhost:3000\n");
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/idps/broken.json"), "{ not json");

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(3));

    expect(text).not.toHaveBeenCalled();
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
    typing(ACME.slug);

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(3));

    expect(asked()).toEqual([QUESTION.slug]);
  });

  it("when the slug is typed and another file already occupies its file name", async () => {
    const cwd = await setUpProject();
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { slug: "something-else" });
    typing(ACME.slug);

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(5));

    expect(asked()).toEqual([QUESTION.slug]);
  });

  it("on a dry run, which never asks, so the flags must say everything", async () => {
    const cwd = await setUpProject();

    await expect(enableCustom(cwd, "--dry-run")).rejects.toMatchObject(exitsWith(3));

    expect(text).not.toHaveBeenCalled();
  });
});

describe("auth-method sso enable --provider custom for a connection that exists", () => {
  it("asks for the slug, then reuses the file without asking for what it holds", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const before = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    vi.mocked(text).mockResolvedValueOnce(ACME.slug as never);
    vi.mocked(text).mockResolvedValue("acme-client-id" as never);
    vi.mocked(password).mockResolvedValue("acme-secret" as never);

    await enableCustom(cwd);

    expect(asked()[0]).toBe(QUESTION.slug);
    expect(asked().filter((message) => /sign-in button|issuer URL|scopes/.test(message))).toEqual(
      [],
    );
    expect(await readdir(join(cwd, ".zitadel/idps"))).toEqual(["acme-sso.json"]);
    expect(await readJson(cwd, ".zitadel/idps/acme-sso.json")).toEqual(before);
  });

  it("refuses a file that holds a setting that cannot be used", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, display_name: "   " });
    typing(ACME.slug);

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(3));

    expect(asked()).toEqual([QUESTION.slug]);
  });

  it("refuses a file that has no issuer, whatever would be typed", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, oidc: {} });
    typing(ACME.slug);

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(5));

    expect(asked()).toEqual([QUESTION.slug]);
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
    typing(ACME.slug, ACME.displayName);

    await expect(enableCustom(cwd, "--issuer", "https://elsewhere.example")).rejects.toMatchObject(
      exitsWith(5),
    );

    expect(asked()).toEqual([QUESTION.slug]);
  });

  it("does not read a stored value that a flag replaces", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, display_name: "   " });
    typing(ACME.slug, "acme-client-id");

    await enableCustom(cwd, "--display-name", ACME.displayName);

    expect(asked().filter((message) => /sign-in button/.test(message))).toEqual([]);
  });

  it("does not hold a stored scope list to the rules, since reuse never applies it", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", {
      ...file,
      oidc: { ...(file.oidc as object), scopes: ["profile"] },
    });
    vi.mocked(text).mockResolvedValueOnce(ACME.slug as never);
    vi.mocked(text).mockResolvedValue("acme-client-id" as never);
    vi.mocked(password).mockResolvedValue("acme-secret" as never);

    await enableCustom(cwd);

    expect(asked().filter((message) => /scopes/.test(message))).toEqual([]);
  });

  it("refuses a stored issuer that cannot be used", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/acme-sso.json", { ...file, oidc: { issuer: "not a url" } });
    typing(ACME.slug);

    await expect(enableCustom(cwd)).rejects.toMatchObject(exitsWith(3));

    expect(asked()).toEqual([QUESTION.slug]);
  });

  it("finds a connection whose file is named differently from its slug", async () => {
    const cwd = await setUpProject();
    await withAcmeConnection(cwd);
    const file = await readJson(cwd, ".zitadel/idps/acme-sso.json");
    await writeJson(cwd, ".zitadel/idps/renamed.json", file);
    await rm(join(cwd, ".zitadel/idps/acme-sso.json"));
    vi.mocked(text).mockResolvedValueOnce(ACME.slug as never);
    vi.mocked(text).mockResolvedValue("acme-client-id" as never);
    vi.mocked(password).mockResolvedValue("acme-secret" as never);

    await enableCustom(cwd);

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
