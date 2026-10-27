import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../../helpers/clack")).clackDouble());

import { password, text } from "@clack/prompts";

import AuthMethodSsoEnable from "../../../../../src/commands/auth-method/sso/enable";
import { setUpProject, withStdin } from "../../../../helpers/local-project";
import { runCliForTest } from "../../../../helpers/run-cli";
import { asTerminal } from "../../../../helpers/terminal";

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

describe("auth-method sso enable --provider custom on a terminal", () => {
  it("asks for the connection's settings, then for its credentials", async () => {
    const cwd = await setUpProject();
    typing(ACME.slug, ACME.displayName, ACME.issuer, ACME.scopes, "acme-client-id");

    await enableCustom(cwd);

    expect(vi.mocked(text).mock.calls.map(([question]) => question.message)).toEqual([
      "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
      "What name should the sign-in button show? For example Acme SSO.",
      "What is the issuer URL of the provider?",
      "Which scopes should we request? Separate them with spaces.",
      "What is the client ID of your Acme SSO OAuth app?",
    ]);
    expect(vi.mocked(password).mock.calls[0]?.[0].message).toBe(
      "What is the client secret of your Acme SSO OAuth app? It will be stored on the project as ACME_SSO_CLIENT_SECRET.",
    );
    await expect(readFile(join(cwd, ".zitadel/idps/acme-sso.json"), "utf8")).resolves.toContain(
      "https://sso.acme.example",
    );
  });

  it("asks only for what the flags left out", async () => {
    const cwd = await setUpProject();
    typing(ACME.displayName, ACME.scopes, "acme-client-id");

    await enableCustom(cwd, "--slug", ACME.slug, "--issuer", ACME.issuer);

    expect(vi.mocked(text).mock.calls.map(([question]) => question.message)).toEqual([
      "What name should the sign-in button show? For example Acme SSO.",
      "Which scopes should we request? Separate them with spaces.",
      "What is the client ID of your Acme SSO OAuth app?",
    ]);
  });

  it("names a mistake in a given flag before asking anything", async () => {
    const cwd = await setUpProject();

    // Exit code 3 is the CLI's validation failure.
    await expect(enableCustom(cwd, "--slug", "Not A Slug")).rejects.toMatchObject({
      oclif: { exit: 3 },
    });

    expect(text).not.toHaveBeenCalled();
  });

  it("asks nothing when every setting was given", async () => {
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

  it("does not ask for what a connection of that name already holds", async () => {
    const cwd = await setUpProject();
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
    vi.mocked(text).mockResolvedValue("acme-client-id" as never);

    await enableCustom(cwd, "--slug", ACME.slug);

    const asked = vi.mocked(text).mock.calls.map(([question]) => question.message);
    expect(
      asked.filter((message) =>
        /call this connection|sign-in button|issuer URL|scopes/.test(message),
      ),
    ).toEqual([]);
  });

  it("explains the claim mappings it wrote for a custom connection", async () => {
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

    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("Claim mappings in .zitadel/idps/acme-sso.json.");
    expect(output).toContain("email ← email");
    expect(output).toContain("Mapping a value does not by itself mark it verified.");
  });
});
