import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import {
  clickFlowAction,
  fillFlowField,
  flowField,
  identity,
  loginWithPassword,
  registerWithPassword,
} from "@zitadel/testing/playwright";

import {
  expectSignedIn,
  gotoLogin,
  type JourneyMetadata,
  journeyMetadataOrSkip,
  logout,
  registrationProfile,
  runCli,
  runCliFailing,
} from "./support";

/**
 * The password policy a release carries is the one sign-up enforces. Setup
 * writes `.zitadel/policies/auth.factor.password.set.json` and deploys it, so
 * a fresh app refuses a password below its minimum. `zitadel policies test`
 * answers as the live sign-up does and refuses an expectation that cannot
 * pass. Deploying a higher minimum raises the bar for new passwords and
 * leaves existing ones signing in; a release that is built but not deployed
 * changes nothing; rolling back brings the earlier minimum back; deploying
 * without the file switches the policy off.
 * Its own Playwright project runs it last, because it leaves the app with no
 * password policy deployed.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const POLICY = ".zitadel/policies/auth.factor.password.set.json";
const POLICY_TEST = ".zitadel/policies/auth.factor.password.set.test.json";

let metadata: JourneyMetadata & { localRuntimeUrl: string };
/** The minimum setup published; the release that serves it is live when the spec starts. */
let setupMinimum: number;
let raisedMinimum: number;
/** A user who registered under the setup minimum, with a password exactly that long. */
const earlyUser = { email: identity().email, password: "" };

test.beforeAll(async () => {
  metadata = await journeyMetadataOrSkip();
  const policy = await readPolicy();
  setupMinimum = policy.config.min_length ?? 0;
  expect(setupMinimum, "setup publishes a minimum length").toBeGreaterThan(1);
  raisedMinimum = setupMinimum + 5;
  earlyUser.password = passwordOf(setupMinimum);
});

test("policies test answers as the deployed policy does", async () => {
  await writePolicyTest([
    {
      name: "one character short is refused",
      input: { password: passwordOf(setupMinimum - 1) },
      expect: { allowed: false, violations: ["min_length"] },
    },
    {
      name: "exactly the minimum is allowed",
      input: { password: passwordOf(setupMinimum) },
      expect: { allowed: true },
    },
  ]);

  const envelope = (await runCli(metadata, [
    "policies",
    "test",
    "--non-interactive",
    "--json",
  ])) as {
    data: { passed: number; failed: number };
  };
  expect(envelope.data).toMatchObject({ passed: 2, failed: 0 });
});

test("policies test refuses an expectation the policy cannot meet", async () => {
  await writePolicyTest([
    {
      name: "one character short is wrongly expected to pass",
      input: { password: passwordOf(setupMinimum - 1) },
      expect: { allowed: true },
    },
  ]);

  const envelope = await runCliFailing(metadata, [
    "policies",
    "test",
    "--non-interactive",
    "--json",
  ]);
  expect(envelope.code).toBe("E_VALIDATION");
  expect(envelope.details).toMatchObject({ passed: 0, failed: 1 });

  await rm(join(metadata.appDir, POLICY_TEST));
});

test("sign-up refuses a password below the setup minimum and takes one at it", async ({ page }) => {
  await expectRefused(page, earlyUser.email, passwordOf(setupMinimum - 1), setupMinimum);
  await submitPassword(page, earlyUser.password);
  await expectSignedIn(page);
  await logout(page);
});

test("a deployed higher minimum applies to new passwords", async ({ page }) => {
  await setMinimum(raisedMinimum);
  await deploy("raise the password minimum");

  const { email } = identity();
  await expectRefused(page, email, passwordOf(setupMinimum), raisedMinimum);
  await submitPassword(page, passwordOf(raisedMinimum));
  await expectSignedIn(page);
  await logout(page);
});

test("a password set under the earlier minimum still signs in", async ({ page }) => {
  await gotoLogin(page);
  await loginWithPassword(page, earlyUser);
  await expectSignedIn(page);
  await logout(page);
});

test("a released but undeployed minimum does not apply", async ({ page }) => {
  await setMinimum(setupMinimum - 1);
  await runCli(metadata, [
    "release",
    "create",
    "-m",
    "lower the password minimum",
    "--non-interactive",
    "--json",
  ]);

  await expectRefused(page, identity().email, passwordOf(setupMinimum), raisedMinimum);
});

test("rolling back brings the setup minimum back", async ({ page }) => {
  // Bare, rollback undoes the last deploy: the raised minimum's.
  await runCli(metadata, ["deployment", "rollback", "--force", "--non-interactive", "--json"]);

  const { email } = identity();
  await expectRefused(page, email, passwordOf(setupMinimum - 1), setupMinimum);
  await submitPassword(page, passwordOf(setupMinimum));
  await expectSignedIn(page);
  await logout(page);
});

test("deploying without the policy file switches the policy off", async ({ page }) => {
  await rm(join(metadata.appDir, POLICY));
  await deploy("remove the password policy");

  await gotoLogin(page);
  await registerWithPassword(page, {
    email: identity().email,
    password: passwordOf(4),
    profile: registrationProfile,
  });
  await expectSignedIn(page);
  await logout(page);
});

/** A password of exactly `length` characters, unique per call. */
function passwordOf(length: number): string {
  const unique = `Pw!${randomUUID().replaceAll("-", "")}`;
  return unique.padEnd(length, "x").slice(0, length);
}

async function readPolicy(): Promise<{ config: { min_length?: number } }> {
  return JSON.parse(await readFile(join(metadata.appDir, POLICY), "utf8")) as {
    config: { min_length?: number };
  };
}

/** Sets the policy file's minimum length, as a developer edits `.zitadel/`. */
async function setMinimum(minLength: number): Promise<void> {
  const policy = await readPolicy();
  policy.config.min_length = minLength;
  await writeFile(join(metadata.appDir, POLICY), `${JSON.stringify(policy, null, 2)}\n`);
}

async function writePolicyTest(cases: unknown[]): Promise<void> {
  const file = { operation: "auth.factor.password.set", cases };
  await writeFile(join(metadata.appDir, POLICY_TEST), `${JSON.stringify(file, null, 2)}\n`);
}

/** Builds a release from `.zitadel/` and deploys it to the project's primary origins. */
async function deploy(message: string): Promise<void> {
  await runCli(metadata, ["deploy", "-m", message, "--non-interactive", "--json"]);
}

/**
 * Starts a password registration with a password the policy refuses, and
 * checks the step stays, naming the minimum. The page is left on that step.
 */
async function expectRefused(page: Page, email: string, password: string, minimum: number) {
  await gotoLogin(page);
  await registerWithPassword(page, { email, password, profile: registrationProfile });
  await expect(
    page.getByText(new RegExp(`at least ${minimum} characters`, "i")).first(),
  ).toBeVisible();
  // Still on the password step: the refusal kept the user from signing up.
  await expect(flowField(page, "password", { label: /password/i })).toBeVisible();
  await expect(page).not.toHaveURL(/\/profile(?:[/?#]|$)/);
}

/** Replaces the password on the current step and submits it. */
async function submitPassword(page: Page, password: string): Promise<void> {
  await fillFlowField(page, "password", password, { label: /password/i });
  await clickFlowAction(page, "submit");
}
