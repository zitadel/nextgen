import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { flowAction, flowField, identity } from "@zitadel/testing/playwright";

import { harness, onProductionDomain, start, zitadel } from "../support/cli";

/**
 * The CLI against the deployment, as a developer meets the hosted cloud: from
 * an empty directory, `setup --server <deployment>` creates a project there,
 * and each test after it runs the next command on that project with
 * `--non-interactive --json`, asserting what the envelope reports and what a
 * second command reads back. Only `claim` runs for a person: its link is the
 * whole instruction, printed for a terminal, and a browser follows it.
 *
 * The setup scaffolds a React app without installing it: the generated app is
 * the journey's (e2e/journey), the deployment's side of each command is this
 * suite's.
 */
test.describe.configure({ mode: "serial" });
test.skip(onProductionDomain(), "each run leaves a project behind: previews only");

const deployment = new URL(process.env.CLOUD_URL ?? "").origin;
const PASSWORD_POLICY = ".zitadel/policies/auth.factor.password.set.json";

let app: string;
let projectId: string;
const releases: string[] = [];

test.beforeAll(async () => {
  // A new empty directory for each attempt, under a name setup accepts as
  // the new app's package name.
  app = join(await mkdtemp(join(harness().dir, "attempt-")), "cloud-app");
  await mkdir(app);
  releases.length = 0;
});

test("setup creates a project on the deployment", async () => {
  const setup = await zitadel(
    ["setup", "--framework", "react", "--server", deployment, "--skip-install"],
    app,
  );

  expect(setup.status, setup.transcript).toBe("ok");
  expect(setup.data.server).toBe(deployment);
  expect(setup.data.project.project_id).toMatch(/^proj_/);
  projectId = setup.data.project.project_id;
});

test("deploy publishes the project's configuration as a release", async () => {
  const deploy = await zitadel(["deploy", "-m", "First release"], app);

  expect(deploy.status, deploy.transcript).toBe("ok");
  expect(deploy.data.release_id).toMatch(/^rel_/);
  releases.push(deploy.data.release_id);
});

test("variable set stores a variable that variable list reads back", async () => {
  const set = await zitadel(["variable", "set", "CLOUD_CHECK", "from-the-cli"], app);
  expect(set.status, set.transcript).toBe("ok");

  const list = await zitadel(["variable", "list"], app);

  expect(list.status, list.transcript).toBe("ok");
  expect(list.data.items).toContainEqual(
    expect.objectContaining({ name: "CLOUD_CHECK", value: "from-the-cli" }),
  );
});

test("origin add allows an origin that origin list reads back", async () => {
  const add = await zitadel(
    ["origin", "add", "https://app.example.test", "--kind", "primary"],
    app,
  );
  expect(add.status, add.transcript).toBe("ok");

  const list = await zitadel(["origin", "list"], app);

  expect(list.status, list.transcript).toBe("ok");
  expect(list.data.items).toContainEqual({ pattern: "https://app.example.test", kind: "primary" });
});

test("deploy publishes a changed configuration as a new release", async () => {
  await changePasswordMinimum(app, 16);

  const deploy = await zitadel(["deploy", "-m", "Second release"], app);

  expect(deploy.status, deploy.transcript).toBe("ok");
  expect(deploy.data.release_id).toMatch(/^rel_/);
  expect(deploy.data.release_id).not.toBe(releases[0]);
  releases.push(deploy.data.release_id);
});

test("deployment list shows both deployments, the latest one live", async () => {
  const list = await zitadel(["deployment", "list"], app);

  expect(list.status, list.transcript).toBe("ok");
  expect(
    list.data.items.map((item: { release_id: string; status: string }) => [
      item.release_id,
      item.status,
    ]),
  ).toEqual([
    [releases[1], "live"],
    [releases[0], "inactive"],
  ]);
});

test("deployment rollback brings the previous release back live", async () => {
  const rollback = await zitadel(["deployment", "rollback", "--force"], app);
  expect(rollback.status, rollback.transcript).toBe("ok");
  expect(rollback.data.release_id).toBe(releases[0]);

  const live = await zitadel(["deployment", "list", "--live"], app);

  expect(live.status, live.transcript).toBe("ok");
  expect(live.data.items.map((item: { release_id: string }) => item.release_id)).toEqual([
    releases[0],
  ]);
});

test("claim links to the console, where signing up claims the project", async ({ page }) => {
  test.setTimeout(240_000);
  const claim = start(["claim", "--non-interactive"], app);
  const printed = await claim.line(/^https?:\/\/\S+\/console\/claim\?\S+$/);
  const link = new URL(printed);
  expect(link.searchParams.get("project_id")).toBe(projectId);

  // The link names the deployment's public URL, which for a preview is the
  // branch's rather than the deployment's own. That it leads to this
  // deployment is what finishing the claim there proves: the challenge exists
  // only in its database.
  await page.goto(link.href);
  await signUp(page);
  await expect(page.getByText("Project claimed")).toBeVisible({ timeout: 60_000 });

  const claimed = await claim.exited();
  expect(claimed.exitCode, claimed.transcript).toBe(0);
  const consoleLinks = claimed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${link.origin}/console/`) && line !== printed);
  expect(consoleLinks, claimed.transcript).toEqual([expect.stringContaining(projectId)]);
});

test("claim again reports the project as already claimed", async () => {
  const claim = await zitadel(["claim"], app);

  expect(claim.status, claim.transcript).toBe("skipped");
  expect(claim.reason).toBe("already-claimed");
});

/** Sets the password policy's minimum length, as a developer edits `.zitadel/`. */
async function changePasswordMinimum(cwd: string, minLength: number): Promise<void> {
  const path = join(cwd, PASSWORD_POLICY);
  const policy = JSON.parse(await readFile(path, "utf8"));
  policy.config.min_length = minLength;
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`);
}

/**
 * Registers a new account in the claim page's sign-in widget, which starts on
 * the default flow's registration step: an email, then a password.
 */
async function signUp(page: import("@playwright/test").Page): Promise<void> {
  const { email, password } = identity();
  await flowField(page, "email", { label: /email/i }).fill(email);
  await flowAction(page, "submit").click();
  await flowField(page, "password", { label: /password/i }).fill(password);
  await flowAction(page, "submit").click();
}
