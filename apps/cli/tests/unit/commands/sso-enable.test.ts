import { access } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { setUpProject, withStdin } from "../../helpers/local-project";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

/** `sso enable` with a secret on stdin, as a scripted caller runs it. */
function ssoEnable(cwd: string, ...extra: string[]) {
  return withStdin("piped-secret", () =>
    runCliForTest([
      "sso",
      "enable",
      "--cwd",
      cwd,
      "--provider",
      "google",
      "--client-id",
      "1234-abc.apps.googleusercontent.com",
      "--json",
      "--non-interactive",
      ...extra,
    ]),
  );
}

const DEPRECATION =
  "`sso enable` is deprecated. Use `auth-method sso enable`, which takes the same flags.";

// `sso enable` is the deprecated alias of `auth-method sso enable` (ADR 069
// §6). Its behaviour is covered by auth-method-sso-enable.test.ts; this file
// covers only what the alias adds.
describe("sso enable (deprecated alias)", () => {
  it("still enables the provider", async () => {
    const cwd = await setUpProject();

    const result = await ssoEnable(cwd);

    expect(result.exitCode).toBe(0);
    await expect(access(join(cwd, ".zitadel/idps/google.json"))).resolves.toBeUndefined();
  });

  it("names the command to use instead", async () => {
    const cwd = await setUpProject();

    const result = await ssoEnable(cwd);

    const envelope = parseJson(result.stdout) as { warnings: string[] };
    expect(envelope.warnings).toContain(DEPRECATION);
  });

  it("names the command to use instead on a dry run too", async () => {
    const cwd = await setUpProject();

    const result = await ssoEnable(cwd, "--dry-run");

    const envelope = parseJson(result.stdout) as { status: string; warnings: string[] };
    expect(envelope).toMatchObject({ status: "skipped", warnings: [DEPRECATION] });
  });

  it("names the command to use instead when the run fails", async () => {
    const cwd = await setUpProject();

    const result = await runCliForTest([
      "sso",
      "enable",
      "--cwd",
      cwd,
      "--json",
      "--non-interactive",
    ]);

    const envelope = parseJson(result.stdout) as { status: string; warnings: string[] };
    expect(envelope).toMatchObject({ status: "error", warnings: [DEPRECATION] });
  });

  it("lists the global flags in its help, like every command", async () => {
    const result = await runCliForTest(["sso", "enable", "--help"]);

    expect(result.stdout).toContain("--cwd");
    expect(result.stdout).toContain("--json");
  });
});
