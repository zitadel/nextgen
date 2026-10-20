import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createZitadelClient, type ZitadelClient } from "@zitadel/api/client";
import { identity, loginWithPassword } from "@zitadel/testing/playwright";

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
 * flow (#1672). A flow names its schema by objectType and runs on the newest
 * revision; a user keeps the revision it was created on. So a user created
 * before a schema publish and one created after it must both sign in, with a
 * password and through the SSO provider, and neither record may change.
 *
 * Both users register through the mock OIDC provider the runner starts
 * (tools/oidc-mock), which creates them without a collection step, so the
 * register step stays the same across the two revisions. Their password is
 * set through the API right after.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const mockUrl = process.env.JOURNEY_OIDC_MOCK_URL ?? "";
const slug = process.env.JOURNEY_OIDC_MOCK_SLUG ?? "";
const clientId = process.env.JOURNEY_OIDC_MOCK_CLIENT_ID ?? "";
const clientSecret = process.env.JOURNEY_OIDC_MOCK_CLIENT_SECRET ?? "";
// The fixed accounts in tools/oidc-mock/users.json.
const mockPassword = "journey-pass";
const userA = { username: "rev1-user", email: "rev1-user@example.com" };
const userB = { username: "rev2-user", email: "rev2-user@example.com" };
// The app password both users get through the API.
const { password } = identity();

let metadata: JourneyMetadata & { localRuntimeUrl: string };
let client: ZitadelClient;
let projectId: string;
let objectType: string;
let revision1: string;
let revision2: string;
type UserRecord = Awaited<ReturnType<ZitadelClient["getUserByID"]>>;
let recordA: UserRecord;
let recordB: UserRecord;

test.beforeAll(async () => {
  metadata = await journeyMetadataOrSkip("schema revisions under one flow");
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
      slug,
      "--display-name",
      "Mock IdP",
      "--issuer",
      mockUrl,
      "--client-id",
      clientId,
    ],
    clientSecret,
  );
  await runCli(metadata, ["apply", "--non-interactive", "--json"]);

  await access(join(metadata.appDir, ".zitadel/idps", `${slug}.json`));
  objectType = (await readSchemaFile()).objectType as string;
  revision1 = await latestRevision();
});

test("registers user A through the provider on revision 1", async ({ page }) => {
  recordA = await registerThroughProvider(page, userA, revision1);
});

test("publishes revision 2", async () => {
  const schema = await readSchemaFile();
  const properties = schema.properties as Record<string, unknown>;
  properties.company = { type: "string" };
  await writeFile(schemaFile(), `${JSON.stringify(schema, null, 2)}\n`);
  await runCli(metadata, ["apply", "--non-interactive", "--json"]);

  revision2 = await latestRevision();
  expect(revision2).not.toBe(revision1);
  const all = await client.listSchemas({
    project_id: projectId,
    object_type: objectType,
    revisions: "all",
  });
  expect(all.schemas.map((schema) => schema.id)).toEqual(
    expect.arrayContaining([revision1, revision2]),
  );

  // The flow names the schema by objectType, not by a revision id, so it
  // runs on revision 2 from now on without being published again.
  const flows = await client.listFlowDefinitions({ project_id: projectId, revisions: "latest" });
  expect(flows.flow_definitions.length).toBeGreaterThan(0);
  for (const flow of flows.flow_definitions) {
    expect(flow.flow_definition.user_schema).toBe(objectType);
  }
});

test("registers user B through the provider on revision 2", async ({ page }) => {
  recordB = await registerThroughProvider(page, userB, revision2);
});

test("both sign in with the password", async ({ page }) => {
  for (const user of [userA, userB]) {
    await gotoLogin(page);
    await loginWithPassword(page, { email: user.email, password });
    await expectSignedIn(page);
    await logout(page);
  }
});

test("both sign in through the provider", async ({ page }) => {
  for (const user of [userA, userB]) {
    // A linked user goes straight to done: no collection step.
    await signInAtProvider(page, user.username);
    await expectSignedIn(page);
    await logout(page);
  }
});

test("user records are unchanged", async () => {
  for (const [record, revision] of [
    [recordA, revision1],
    [recordB, revision2],
  ] as const) {
    const now = await client.getUserByID(record.id);
    expect(now.schema).toBe(revision);
    expect(now.attributes).toEqual(record.attributes);
    expect(now.metadata.updated_at).toBe(record.metadata.updated_at);
  }
});

function schemaFile(): string {
  return join(metadata.appDir, ".zitadel/schemas/default-human-user.json");
}

async function readSchemaFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(schemaFile(), "utf8")) as Record<string, unknown>;
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
  await page.getByTestId(`zitadel-sso-provider-${slug}`).click();
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

  const { users } = await client.queryUsers({}, { project_id: projectId });
  const created = users.find((candidate) => candidate.identifier === user.email);
  expect(created, `${user.email} was not created`).toBeDefined();
  const id = created?.id ?? "";
  expect(created?.schema).toBe(revision);
  await client.setUserPassword(id, { password });

  await logout(page);
  return client.getUserByID(id);
}
