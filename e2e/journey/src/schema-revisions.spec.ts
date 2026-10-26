import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createZitadelClient, type ZitadelClient } from "@zitadel/api/client";
import { identity, loginWithPassword } from "@zitadel/testing/playwright";

import {
  OIDC_MOCK_CLIENT_ID,
  OIDC_MOCK_CLIENT_SECRET,
  OIDC_MOCK_SLUG,
} from "../scripts/oidc-mock.mjs";
import {
  expectSignedIn,
  gotoLogin,
  type JourneyMetadata,
  journeyMetadataOrSkip,
  logout,
  runCli,
} from "./support";

/**
 * Users created on two revisions of one user schema sign in under the same
 * flow (#1672). A flow names its schema by objectType, and a registration
 * lands on the revision the release serving the app's origin pins under it
 * (#1673); a user keeps the revision it was created on. So a user created
 * before a schema deploy and one created after it must both sign in, with a
 * password and through the SSO provider, and neither record may change. A
 * revision that is released but not deployed must not take new users.
 * Rolling back to the first release (#2115) moves new registrations back to
 * revision 1 and changes no user: everyone still signs in both ways.
 * Its own Playwright project runs it after the other specs, because it leaves
 * the app with SSO enabled, an IdP connection, schema revision 3 released and
 * the first release, pinning revision 1, deployed again.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const mockUrl = process.env.JOURNEY_OIDC_MOCK_URL ?? "";
// The fixed accounts in tools/oidc-mock/users.json.
const mockPassword = "journey-pass";
const userA = { username: "rev1-user", email: "rev1-user@example.com" };
const userB = { username: "rev2-user", email: "rev2-user@example.com" };
const userC = { username: "pinned-user", email: "pinned-user@example.com" };
const userD = { username: "rollback-user", email: "rollback-user@example.com" };
// The app password every user gets through the API.
const { password } = identity();

let metadata: JourneyMetadata & { localRuntimeUrl: string };
let client: ZitadelClient;
let projectId: string;
let objectType: string;
let revision1: string;
let revision2: string;
let revision3: string;
type UserRecord = Awaited<ReturnType<ZitadelClient["getUserByID"]>>;
let recordA: UserRecord;
let recordB: UserRecord;
let recordC: UserRecord;
let recordD: UserRecord;
let releaseA: string;

/**
 * Builds a release from `.zitadel/` and deploys it to the project's primary
 * origins. Setup registered the app's own dev URL as one, so the release is
 * what the browser's sign-in is served. Returns the release's id.
 */
async function deploy(message: string): Promise<string> {
  const envelope = (await runCli(metadata, [
    "deploy",
    "-m",
    message,
    "--non-interactive",
    "--json",
  ])) as { data: { release_id: string } };
  return envelope.data.release_id;
}

test.beforeAll(async () => {
  metadata = await journeyMetadataOrSkip();
  test.skip(!mockUrl, "mock OIDC provider not started");
  const secret = JSON.parse(await readFile(join(metadata.appDir, ".zitadel/secret"), "utf8")) as {
    project_id: string;
    project_secret: string;
  };
  projectId = secret.project_id;
  client = createZitadelClient({ baseUrl: metadata.localRuntimeUrl, token: secret.project_secret });
});

test("enables the mock provider", async () => {
  await runCli(
    metadata,
    [
      "auth-method",
      "sso",
      "enable",
      "--non-interactive",
      "--json",
      "--provider",
      "custom",
      "--slug",
      OIDC_MOCK_SLUG,
      "--display-name",
      "Mock IdP",
      "--issuer",
      mockUrl,
      "--client-id",
      OIDC_MOCK_CLIENT_ID,
    ],
    OIDC_MOCK_CLIENT_SECRET,
  );
  releaseA = await deploy("enable the mock provider");

  objectType = (await readSchemaFile()).objectType as string;
  revision1 = await latestRevision();
});

test("registers user A through the provider on revision 1", async ({ page }) => {
  recordA = await registerThroughProvider(page, userA, revision1);
});

test("deploys revision 2", async () => {
  await addSchemaProperty("company");
  await deploy("add company to the user schema");

  revision2 = await latestRevision();
  expect(revision2).not.toBe(revision1);

  // The flow names the schema by objectType, so the deployed release decides
  // which revision it runs on: revision 2 from now on.
  const flows = await client.listFlowDefinitions({ project_id: projectId, revisions: "latest" });
  expect(flows.flow_definitions.length).toBeGreaterThan(0);
  for (const flow of flows.flow_definitions) {
    expect(flow.flow_definition.user_schema).toBe(objectType);
  }
});

test("registers user B through the provider on revision 2", async ({ page }) => {
  recordB = await registerThroughProvider(page, userB, revision2);
});

test("releases revision 3 without deploying it", async () => {
  await addSchemaProperty("department");
  await runCli(metadata, [
    "release",
    "create",
    "-m",
    "add department to the user schema",
    "--non-interactive",
    "--json",
  ]);

  revision3 = await latestRevision();
  expect(revision3).not.toBe(revision2);
});

test("registers user C through the provider on the deployed revision 2", async ({ page }) => {
  recordC = await registerThroughProvider(page, userC, revision2);
});

test("all sign in with the password", async ({ page }) => {
  await expectPasswordSignIns(page, [userA, userB, userC]);
});

test("all sign in through the provider", async ({ page }) => {
  await expectProviderSignIns(page, [userA, userB, userC]);
});

test("user records are unchanged", async () => {
  await expectRecordsUnchanged([
    [recordA, revision1],
    [recordB, revision2],
    [recordC, revision2],
  ]);
});

test("rolls back to the release pinning revision 1", async () => {
  // Bare, rollback undoes the last deploy: revision 3 was only released, so
  // that deploy is the one of revision 2, and release A is served again.
  const envelope = (await runCli(metadata, [
    "deployment",
    "rollback",
    "--force",
    "--non-interactive",
    "--json",
  ])) as { data: { release_id: string } };
  expect(envelope.data.release_id).toBe(releaseA);
});

test("registers user D through the provider on revision 1 after the rollback", async ({ page }) => {
  recordD = await registerThroughProvider(page, userD, revision1);
});

test("all sign in with the password after the rollback", async ({ page }) => {
  await expectPasswordSignIns(page, [userA, userB, userC, userD]);
});

test("all sign in through the provider after the rollback", async ({ page }) => {
  await expectProviderSignIns(page, [userA, userB, userC, userD]);
});

test("the rollback changed no user record", async () => {
  await expectRecordsUnchanged([
    [recordA, revision1],
    [recordB, revision2],
    [recordC, revision2],
    [recordD, revision1],
  ]);
});

async function expectPasswordSignIns(page: Page, users: { email: string }[]): Promise<void> {
  for (const user of users) {
    await gotoLogin(page);
    await loginWithPassword(page, { email: user.email, password });
    await expectSignedIn(page);
    await logout(page);
  }
}

async function expectProviderSignIns(page: Page, users: { username: string }[]): Promise<void> {
  for (const user of users) {
    // A linked user goes straight to done: no collection step.
    await signInAtProvider(page, user.username);
    await expectSignedIn(page);
    await logout(page);
  }
}

/** Each user still has the revision, attributes and update time it was recorded with. */
async function expectRecordsUnchanged(expected: (readonly [UserRecord, string])[]): Promise<void> {
  for (const [record, revision] of expected) {
    const now = await client.getUserByID(record.id);
    expect(now.schema).toBe(revision);
    expect(now.attributes).toEqual(record.attributes);
    expect(now.metadata.updated_at).toBe(record.metadata.updated_at);
  }
}

function schemaFile(): string {
  return join(metadata.appDir, ".zitadel/schemas/default-human-user.json");
}

async function readSchemaFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(schemaFile(), "utf8")) as Record<string, unknown>;
}

/** Adds an optional string attribute to the schema file, for the next build to publish. */
async function addSchemaProperty(name: string): Promise<void> {
  const schema = await readSchemaFile();
  const properties = schema.properties as Record<string, unknown>;
  properties[name] = { type: "string" };
  await writeFile(schemaFile(), `${JSON.stringify(schema, null, 2)}\n`);
}

async function latestRevision(): Promise<string> {
  const latest = await client.listSchemas({
    project_id: projectId,
    object_type: objectType,
    revisions: "latest",
  });
  expect(latest.schemas).toHaveLength(1);
  return latest.schemas[0]?.id ?? "";
}

/** Clicks the provider button on the app's sign-in page and signs in at the mock. */
async function signInAtProvider(page: Page, username: string): Promise<void> {
  await gotoLogin(page);
  await page.getByTestId(`zitadel-sso-provider-${OIDC_MOCK_SLUG}`).click();
  // The mock keeps no session, so it shows its form every time.
  await page.waitForURL(/\/login\/username/);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(mockPassword);
  await page.getByRole("button", { name: "Login" }).click();
}

/**
 * Registers a new user through the provider, checks it landed on `revision`,
 * sets its app password and signs out. Returns the record after the password
 * is set, for the last test to compare against.
 */
async function registerThroughProvider(
  page: Page,
  user: { username: string; email: string },
  revision: string,
): Promise<UserRecord> {
  await signInAtProvider(page, user.username);
  await expectSignedIn(page);

  const { users } = await client.queryUsers({ limit: 100 }, { project_id: projectId });
  const created = users.find((candidate) => candidate.identifier === user.email);
  if (!created) throw new Error(`${user.email} was not created`);
  expect(created.schema).toBe(revision);
  await client.setUserPassword(created.id, { password });

  await logout(page);
  return client.getUserByID(created.id);
}
