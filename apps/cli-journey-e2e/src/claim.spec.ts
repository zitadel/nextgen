/* oxlint-disable playwright/no-conditional-in-test */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";
import { registerWithPassword } from "@zitadel/testing/playwright";

/**
 * The local ownership journey. `zitadel start` boots the server with the
 * platform project and a local admin, and `zitadel setup --server local`
 * attaches the new project to that admin's team, so on a local server:
 *
 * - the prepared app is owned from the start and `zitadel claim` has nothing
 *   left to do,
 * - `zitadel console` mints a one-time link that signs the admin in to the
 *   local server's own console, with no password, and
 * - that admin can hand the project to a colleague and take it back again
 *   from the console's own Admins section (#1295).
 *
 * Claiming an anonymous project stays a cloud journey. These checks are
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

/**
 * Labels and copy owned by the console, retyped rather than imported: this
 * project does not compile console source, and the real-instance lane
 * (`apps/console-e2e/src-real/console-real.spec.ts`) mirrors them the same way.
 */
const NEUTRAL_MESSAGE =
  "If the user exists in our system, they have been granted access to your project.";
/**
 * Every heading `apps/console/src/components/boundaries.tsx` renders for a
 * failed route load: "Not authorized" (403), "Request failed (404)" and the
 * generic fallback. One locator, so which status the read answers with does not
 * decide whether the boundary is found.
 */
const ERROR_BOUNDARY_HEADING = /Not authorized|Request failed \(\d+\)|Something went wrong/;

test("a local project is owned from setup, and the console signs the local admin in", async ({
  page,
}) => {
  const metadata = await journeyMetadataOrSkip();
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

test("the setup admin can add and remove a project admin, and the colleague sees it", async ({
  browser,
  page,
}) => {
  const metadata = await journeyMetadataOrSkip();
  const serverOrigin = new URL(metadata.localRuntimeUrl).origin;
  const secret = JSON.parse(await readFile(join(metadata.appDir, ".zitadel/secret"), "utf8")) as {
    project_id: string;
  };
  const projectUrl = `${serverOrigin}/ui/console/projects/${secret.project_id}`;
  const email = `colleague-${Date.now()}@example.com`;

  // The colleague signs up at the console's own sign-in screen, in their own
  // context. That screen signs in to the platform project, which is the only
  // place "Add admin" can find them: the grant service resolves an email
  // against the caller's home project, so a colleague registered in the app
  // project is silently not granted (#1295).
  const colleagueContext = await browser.newContext();
  try {
    const colleaguePage = await colleagueContext.newPage();
    await colleaguePage.goto(`${serverOrigin}/ui/console/login`);
    await registerWithPassword(colleaguePage, { email, password: "Colleague-pass-123!" });
    await expect(colleaguePage).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // The admin signs in through a fresh one-time link, as above.
    const consoleLink = (await runCli(metadata, ["console", "--no-open", "--json"])) as {
      data?: { sign_in_url?: string };
    };
    await page.goto(consoleLink.data?.sign_in_url ?? "");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // Locators copied from `apps/console-e2e/src-real/console-real.spec.ts`,
    // which proves the same screen against an API-created project.
    await page.goto(projectUrl);
    await expect(page.getByRole("region", { name: "Admins" })).toBeVisible();
    await page.getByRole("button", { name: "Add admin", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add admin" });
    await dialog.getByRole("textbox", { name: "Email address" }).fill(email);
    await dialog.getByRole("button", { name: "Add admin", exact: true }).click();
    await expect(page.getByText(NEUTRAL_MESSAGE)).toBeVisible();

    // The row is what proves the write landed: it comes back from the list
    // read, and the message above says the same thing whether or not anything
    // was created.
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByText("Admin", { exact: true })).toBeVisible();

    // And the grant is what the colleague's own session can now open.
    await colleaguePage.goto(projectUrl);
    await expect(colleaguePage.getByRole("region", { name: "Admins" })).toBeVisible();

    await row.getByRole("button", { name: `Actions for ${email}` }).click();
    await page.getByRole("menuitem", { name: "Remove admin" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove admin", exact: true })
      .click();
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    await expect(page.getByText(ERROR_BOUNDARY_HEADING)).toHaveCount(0);

    // The colleague loses the project with the grant: the page's loader fails,
    // so the route's error boundary replaces the screen it rendered before.
    await colleaguePage.reload();
    await expect(colleaguePage.getByText(ERROR_BOUNDARY_HEADING)).toBeVisible();
  } finally {
    await colleagueContext.close();
  }
});

/**
 * The journey's own metadata, plus the lanes this suite stays out of: local
 * ownership is framework-independent, the fresh-app lane already covers it, and
 * the docker lane keeps to the scaffold journey.
 */
async function journeyMetadataOrSkip(): Promise<JourneyMetadata & { localRuntimeUrl: string }> {
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
  return { ...metadata, localRuntimeUrl: metadata.localRuntimeUrl };
}

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
