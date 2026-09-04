/* oxlint-disable playwright/no-conditional-in-test, no-control-regex */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { registerWithPassword } from "@zitadel/testing/playwright";

/**
 * The whole claim journey, both legs at once: `zitadel claim` mints the
 * challenge and polls, Playwright plays the human finishing in the embedded
 * console. The regression this pins down (#613 follow-up): the server must
 * advertise the claim page on its own public base — a CLI-launched local
 * server that pointed at the cloud default made the browser leg impossible.
 *
 * Claim is framework-independent; one suite proves it end to end without
 * slowing every lane (same reasoning as the doctor drift probe).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test("zitadel claim completes against the local server's own console", async ({ page }) => {
  const outputDir = requiredEnv("JOURNEY_OUTPUT_DIR");
  const metadata = JSON.parse(await readFile(join(outputDir, "metadata.json"), "utf8")) as {
    appDir: string;
    cliPackage: string;
    framework: string;
    localRuntimeUrl: string | null;
    outputDir: string;
    preset: string | null;
    registryUrl: string;
    runtime: string;
  };
  test.skip(metadata.framework !== "next", "claim is framework-independent; next lane only");
  test.skip(
    metadata.preset !== null && metadata.preset !== "password-first",
    "the browser leg registers with a password",
  );
  test.skip(
    process.env.JOURNEY_PREEXISTING_APP === "1",
    "the fresh-app lane already proves claim; keep the preexisting lane lean",
  );
  test.skip(
    metadata.runtime === "docker",
    "the harness bootstrap env does not reach the docker container, so claim completion 401s there",
  );
  if (!metadata.localRuntimeUrl) throw new Error("metadata.json has no localRuntimeUrl");
  const serverOrigin = new URL(metadata.localRuntimeUrl).origin;

  const secretPath = join(metadata.appDir, ".zitadel/secret");
  const before = JSON.parse(await readFile(secretPath, "utf8")) as {
    project_id: string;
    team_id?: string;
  };
  expect(before.team_id, "the prepared app must not be claimed yet").toBeUndefined();

  const cli = spawnClaim(metadata);
  let output = "";
  cli.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  cli.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  // The URL lives inside a consola box; strip ANSI codes, box-drawing
  // characters, and all whitespace (borders and wrapping would otherwise
  // split the URL), then match the challenge token against the project id we
  // already know — in the flattened text the id is what anchors the token's
  // end.
  const flatOutput = (): string =>
    output
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/[─-╿]/g, "")
      .replace(/\s+/g, "");
  const extractChallengeId = (): string | null => {
    const match = flatOutput().match(
      new RegExp(
        `/ui/console/claim\\?challenge_id=([A-Za-z0-9_.~%-]+)&project_id=${before.project_id}`,
      ),
    );
    return match?.[1] ?? null;
  };

  try {
    await expect.poll(extractChallengeId, { timeout: 60_000 }).not.toBeNull();
    const claimUrl =
      `${serverOrigin}/ui/console/claim` +
      `?challenge_id=${extractChallengeId() ?? ""}&project_id=${before.project_id}`;

    // The regression assertion: the advertised claim page is on the local
    // server itself, not on a remote default the tester would have to fix up.
    expect(flatOutput()).toContain(`${serverOrigin}/ui/console/claim?challenge_id=`);

    // Browser leg: the claim page renders the sign-in widget inline; a fresh
    // registration provisions the personal team the completion attaches to.
    await page.goto(claimUrl);
    await registerWithPassword(page, {
      email: `claim-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`,
      password: "Correct-Horse-44!",
      profile: [
        { field: "givenName", value: "Grace", label: /given.?name/i },
        { field: "familyName", value: "Hopper", label: /family.?name/i },
        { field: "dateOfBirth", value: "1990-01-15", label: /date.?of.?birth/i },
      ],
    });
    await skipPasskeyUpsellIfVisible(page);

    // The widget's terminal step navigates back here with the cookie in
    // place, and the page completes the claim on its own.
    await expect(page.getByText("Project claimed")).toBeVisible({ timeout: 60_000 });

    // CLI leg: the poll sees the completion and exits cleanly. The child may
    // have exited while the browser leg ran, so read the buffered exit code
    // before subscribing — a late `once` would wait forever.
    const exitCode =
      cli.exitCode ?? ((await once(cli, "exit")) as [number | null])[0];
    expect(exitCode, `CLI output was:\n${output}`).toBe(0);
  } finally {
    if (cli.exitCode === null) cli.kill("SIGTERM");
  }

  const after = JSON.parse(await readFile(secretPath, "utf8")) as {
    team_id?: string;
    claimed_at?: string;
  };
  expect(after.team_id).toEqual(expect.any(String));
  expect(after.claimed_at).toEqual(expect.any(String));
});

/**
 * Same npx invocation shape as prepare-app's steps (same registry and cache,
 * so the package resolves warm), but interactive-shaped: no `--json`, because
 * the envelope silences the consola narration that carries the claim URL.
 * `--no-open` keeps the headless run from trying to launch a browser.
 */
function spawnClaim(metadata: {
  appDir: string;
  cliPackage: string;
  outputDir: string;
  registryUrl: string;
}): ChildProcess {
  return spawn(
    "npx",
    ["--yes", `${metadata.cliPackage}@alpha`, "claim", "--cwd", metadata.appDir, "--no-open"],
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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function skipPasskeyUpsellIfVisible(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: /skip for now/i });
  const outcome = await Promise.race([
    skip.waitFor({ state: "visible", timeout: 30_000 }).then(() => "passkey-upsell" as const),
    page
      .getByText("Project claimed")
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "claimed" as const),
  ]).catch(() => {
    throw new Error(`Timed out waiting for claim result or passkey upsell; URL: ${page.url()}`);
  });
  if (outcome === "passkey-upsell") {
    await skip.click();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
