/* oxlint-disable playwright/no-conditional-in-test */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

/**
 * The local ownership journey. `zitadel start` boots the server with the
 * platform project and a local admin, and `zitadel setup --server local`
 * attaches the new project to that admin's team, so on a local server:
 *
 * - the prepared app is owned from the start and `zitadel claim` has nothing
 *   left to do, and
 * - `zitadel console` mints a one-time link that signs the admin in to the
 *   local server's own console, with no password.
 *
 * Claiming an anonymous project stays a cloud journey. Both checks are
 * framework-independent; one suite proves them end to end without slowing
 * every lane (same reasoning as the doctor drift probe).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

type JourneyMetadata = {
  appDir: string;
  cliPackage: string;
  framework: string;
  localRuntimeUrl: string | null;
  outputDir: string;
  preset: string | null;
  registryUrl: string;
  runtime: string;
};

test("a local project is owned from setup, and the console signs the local admin in", async ({
  page,
}) => {
  const metadata = JSON.parse(
    await readFile(join(requiredEnv("JOURNEY_OUTPUT_DIR"), "metadata.json"), "utf8"),
  ) as JourneyMetadata;
  test.skip(metadata.framework !== "next", "local ownership is framework-independent; next lane only");
  test.skip(
    process.env.JOURNEY_PREEXISTING_APP === "1",
    "the fresh-app lane already proves local ownership; keep the preexisting lane lean",
  );
  test.skip(
    metadata.runtime === "docker",
    "the binary lane proves local ownership; the docker lane keeps to the scaffold journey",
  );
  if (!metadata.localRuntimeUrl) throw new Error("metadata.json has no localRuntimeUrl");
  const serverOrigin = new URL(metadata.localRuntimeUrl).origin;

  // setup already attached the project to the local admin's team.
  const secret = JSON.parse(await readFile(join(metadata.appDir, ".zitadel/secret"), "utf8")) as {
    project_id: string;
    team_id?: string;
    claimed_at?: string;
  };
  expect(secret.team_id, "local setup must leave the project owned").toEqual(expect.any(String));
  expect(secret.claimed_at).toEqual(expect.any(String));

  // So claim has nothing to do.
  const claim = (await runCli(metadata, ["claim", "--json"])) as {
    status: string;
    reason?: string;
    data?: { project_id?: string; team_id?: string };
  };
  expect(claim.status).toBe("skipped");
  expect(claim.reason).toBe("already-claimed");
  expect(claim.data?.project_id).toBe(secret.project_id);
  expect(claim.data?.team_id).toBe(secret.team_id);

  // The console link lands on the local server itself and signs the admin in.
  const consoleLink = (await runCli(metadata, ["console", "--no-open", "--json"])) as {
    status: string;
    data?: { sign_in_url?: string; signed_in_as?: string };
  };
  expect(consoleLink.status).toBe("ok");
  const signInUrl = consoleLink.data?.sign_in_url ?? "";
  expect(signInUrl.startsWith(`${serverOrigin}/ui/console/login?handoff=`)).toBe(true);

  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  const me = await page.evaluate(async () => {
    const res = await fetch("/sessions/me", { credentials: "include" });
    return { status: res.status, body: (await res.json()) as { user?: { identifier?: string } } };
  });
  expect(me.status).toBe(200);
  expect(me.body.user?.identifier).toBe(consoleLink.data?.signed_in_as);
});

/**
 * Same npx invocation shape as prepare-app's steps (same registry and cache, so
 * the package resolves warm), returning the parsed `--json` envelope.
 */
async function runCli(metadata: JourneyMetadata, args: string[]): Promise<unknown> {
  const { stdout } = await promisify(execFile)(
    "npx",
    ["--yes", `${metadata.cliPackage}@alpha`, ...args, "--cwd", metadata.appDir],
    {
      cwd: metadata.appDir,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_cache: join(metadata.outputDir, ".npm-cache"),
        npm_config_fund: "false",
        npm_config_registry: metadata.registryUrl,
        npm_config_yes: "true",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as unknown;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
