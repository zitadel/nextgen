import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { describe, expect, vi } from "vitest";

import type { JsonObject } from "@/lib/zitadel";
import {
  authMethodJson,
  authMethodText,
  LOGIN_FLOW_FILE,
  SCHEMA_FILE,
  schemaIdOf,
} from "@tests/helpers/auth-method";
import { aGoogleConnection, type DocumentsByName } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { withStep } from "@tests/helpers/flows";
import {
  defaultSchema,
  loginFlow,
  makeProject,
  readJson,
  setUpProject,
  withStdin,
  writeJson,
} from "@tests/helpers/local-project";
import { usePlatformServer } from "@tests/helpers/platform-project";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "@tests/helpers/run-cli";

/**
 * The subcommand and provider every Google run names.
 */
const GOOGLE = ["sso", "enable", "--provider", "google"] as const;

/**
 * The subcommand and settings of the custom `acme-sso` connection.
 */
const ACME = [
  "sso",
  "enable",
  "--provider",
  "custom",
  "--slug",
  "acme-sso",
  "--display-name",
  "Acme SSO",
  "--issuer",
  "https://sso.acme.example",
] as const;

/**
 * The client id of the Google OAuth application a developer registered.
 */
const CLIENT_ID = "1234-abc.apps.googleusercontent.com";

/**
 * A client id other than {@link CLIENT_ID}, of another OAuth application.
 */
const OTHER_CLIENT_ID = "5678-def.apps.googleusercontent.com";

/**
 * The client id of the `acme-sso` OAuth application.
 */
const ACME_CLIENT_ID = "acme-client-id";

/**
 * The client secret a scripted run pipes in on stdin. Both credentials are
 * required, so a scripted run without one is refused before it writes anything.
 */
const SECRET = "piped-secret";

/**
 * Where the Google connection is written.
 */
const CONNECTION_FILE = ".zitadel/idps/google.json";

/**
 * The URI the developer registers with Google for the connection.
 */
const CALLBACK_URI = "http://localhost:3000/__nextgen/idp/google/callback";

/**
 * The project the linked Project publishes to.
 */
const PROJECT_ID = "proj_01TEST";

/**
 * What the run says of a region it left alone because someone edited it.
 */
const HAND_EDITED = "has been edited by hand";

/**
 * The files a first run changes, in the order it reports them.
 */
const CHANGED = [SCHEMA_FILE, LOGIN_FLOW_FILE, CONNECTION_FILE];

/**
 * A Project as `zitadel setup` leaves it, each schema carrying the `$id` its
 * login flow names it by.
 *
 * @param dir - The directory to write the Project into.
 * @param schemas - The schemas, by file name without `.json`.
 * @returns The Project's directory.
 */
function aProject(
  dir: string,
  schemas: DocumentsByName = { "default-human-user": defaultSchema },
): Promise<string> {
  const named = Object.entries(schemas).map(([name, body]) => {
    return [name, { $id: schemaIdOf(name), ...body }];
  });
  return setUpProject(dir, Object.fromEntries(named));
}

/**
 * A Project where Google was already enabled with {@link CLIENT_ID}.
 *
 * @param dir - The directory to write the Project into.
 * @returns The Project's directory.
 */
async function aProjectWithGoogle(dir: string): Promise<string> {
  const cwd = await aProject(dir);
  await withStdin(SECRET, () => {
    return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
  });
  return cwd;
}

/**
 * A password step someone wrote by hand, with copy of their own.
 */
const EDITED_PASSWORD_STEP = {
  name: "password",
  fields: ["x-auth-methods#password"],
  actions: [{ name: "submit", kind: "submit", primary: true, text_key: "my.own.copy" }],
  transitions: { submit: { target: "done" } },
};

/**
 * A Project whose login flow has {@link EDITED_PASSWORD_STEP} in place of its
 * password step.
 *
 * @param dir - The directory to write the Project into.
 * @returns The Project's directory.
 */
async function aProjectWithAnEditedPasswordStep(dir: string): Promise<string> {
  const cwd = await aProject(dir);
  await writeJson(
    cwd,
    LOGIN_FLOW_FILE,
    withStep(loginFlow("default-human-user"), "password", () => {
      return EDITED_PASSWORD_STEP;
    }),
  );
  return cwd;
}

/**
 * A step that collects the staff number in place of the email.
 *
 * @param step - The step.
 * @returns The step, collecting `staffNumber` alone.
 */
function collectingStaffNumber(step: JsonObject): JsonObject {
  return { ...step, fields: ["staffNumber"] };
}

/**
 * A Project holding a Google connection someone wrote by hand.
 *
 * @param dir - The directory to write the Project into.
 * @param oidc - The `oidc` keys the hand-written connection holds.
 * @returns The Project's directory.
 */
async function aProjectWithAHandWrittenConnection(
  dir: string,
  oidc: Record<string, string>,
): Promise<string> {
  const cwd = await aProject(dir);
  await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
  await writeJson(cwd, CONNECTION_FILE, aGoogleConnection({ oidc }));
  return cwd;
}

/**
 * The platform the credentials are published to. No test names a server, so
 * the command publishes to the one it resolves by default, and msw answers in
 * its place: every publish is accepted unless the test refuses it.
 */
const { server: platform } = usePlatformServer();

/**
 * Makes every publish fail before it reaches the project, as an unreachable
 * server would.
 */
function refusePublishes(): void {
  platform.use(
    http.patch("*/variables", () => {
      return HttpResponse.error();
    }),
  );
}

describe("auth-method sso enable", () => {
  describe("with a Project as setup leaves it", () => {
    it("reports the connection it created", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        data: { connection: { action: "create", slug: "google", file: CONNECTION_FILE } },
      });
    });

    it("reports the callback URI to register", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({ data: { callback_uri: CALLBACK_URI } });
    });

    it("lists the files it changed", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({ data: { changed: CHANGED } });
    });

    it.for([
      ["client_id", "${{ GOOGLE_CLIENT_ID }}"],
      ["client_secret", "${{ GOOGLE_CLIENT_SECRET }}"],
    ] as const)(
      "writes the %s as a reference to a project variable",
      async ([key, reference], { dir }) => {
        const cwd = await aProject(dir);

        await withStdin(SECRET, () => {
          return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
        });

        expect(await readJson(cwd, CONNECTION_FILE)).toMatchObject({ oidc: { [key]: reference } });
      },
    );

    it("maps only the claims the schema defines", async ({ dir }) => {
      const cwd = await aProject(dir);

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect((await readJson(cwd, CONNECTION_FILE)).claim_mapping).toEqual({ email: "email" });
    });

    it("writes the vendor's own issuer", async ({ dir }) => {
      const cwd = await aProject(dir);

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(await readJson(cwd, CONNECTION_FILE)).toMatchObject({
        oidc: { issuer: "https://accounts.google.com" },
      });
    });

    it.for(["authorization_endpoint", "token_endpoint"])(
      "writes no %s, leaving it to the vendor's discovery document",
      async (endpoint, { dir }) => {
        const cwd = await aProject(dir);

        await withStdin(SECRET, () => {
          return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
        });

        expect(await readJson(cwd, CONNECTION_FILE)).not.toHaveProperty(["oidc", endpoint]);
      },
    );

    it("stores the piped secret on the project", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: { secret: { variable: "GOOGLE_CLIENT_SECRET", published: "stored" } },
      });
    });

    it("writes the secret to no file in the Project", async ({ dir }) => {
      const cwd = await aProject(dir);

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(await readFile(join(cwd, ".env.local"), "utf8")).not.toContain(SECRET);
    });

    it.for(["stdout", "stderr"] as const)("keeps the secret out of %s", async (stream, { dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(result[stream]).not.toContain(SECRET);
    });

    it("suggests a dry run and a deploy, each with --cwd", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          next_args: [
            ["deploy", "--dry-run", "--cwd", cwd],
            ["deploy", "-m", "<what changed>", "--cwd", cwd],
          ],
        },
      });
    });

    it.for([
      ["a run", []],
      ["a dry run", ["--dry-run"]],
    ] as const)(
      "names the project it changes on %s, since --json prints no line naming it",
      async ([_, mode], { dir }) => {
        const cwd = await aProject(dir);

        const result = await withStdin(SECRET, () => {
          return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, ...mode));
        });

        expect(parseJson(result.stdout)).toMatchObject({ data: { project_id: PROJECT_ID } });
      },
    );

    it.for([
      "Google is set up",
      "Provider credentials are stored on your Project.",
      "Deploy, so Google sign-in reaches your app:",
      `\`${expectedPublicCliCommand("deploy --dry-run")}`,
    ])("says %s", async (line, { dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(result.stdout).toContain(line);
    });
  });

  describe("when publishing the credentials fails", () => {
    it("says the provider is saved locally", async ({ dir }) => {
      const cwd = await aProject(dir);
      refusePublishes();

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(result.stdout).toContain("Saved in your project. Not applied, not tested.");
    });

    it("does not say the credentials are stored", async ({ dir }) => {
      const cwd = await aProject(dir);
      refusePublishes();

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(result.stdout).not.toContain("stored on your Project");
    });

    it("reports the secret the project never received", async ({ dir }) => {
      const cwd = await aProject(dir);
      refusePublishes();

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        data: { secret: { variable: "GOOGLE_CLIENT_SECRET", published: "failed" } },
      });
    });

    it("suggests the command that publishes the secret again", async ({ dir }) => {
      const cwd = await aProject(dir);
      refusePublishes();

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          next_commands: expect.arrayContaining([
            expect.stringContaining("variable set GOOGLE_CLIENT_SECRET --secret"),
          ]),
        },
      });
    });

    it("renders every follow-up as a command an agent can run", async ({ dir }) => {
      const cwd = await aProject(dir);
      refusePublishes();

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: { next_commands: expect.not.arrayContaining([expect.not.stringMatching(/^npx /)]) },
      });
    });

    it("suggests publishing the client id again first, with --cwd", async ({ dir }) => {
      const cwd = await aProject(dir);
      refusePublishes();

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toHaveProperty(
        ["data", "next_args", 0],
        ["variable", "set", "GOOGLE_CLIENT_ID", "--cwd", cwd],
      );
    });
  });

  describe("when the password step was edited by hand", () => {
    it.for(["Add google to its sso_providers", "user_already_exists to sso-conflict"])(
      "says %s",
      async (line, { dir }) => {
        const cwd = await aProjectWithAnEditedPasswordStep(dir);

        const result = await withStdin(SECRET, () => {
          return runCliForTest(authMethodText(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
        });

        expect(result.stderr).toContain(line);
      },
    );

    it("leaves the step alone, and says so once, by step name", async ({ dir }) => {
      const cwd = await aProjectWithAnEditedPasswordStep(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          notices: [
            {
              message: expect.stringMatching(
                /^\.zitadel\/flows\/default-human-user-login\.json steps\.password has been edited by hand, so it was left alone\./,
              ),
            },
          ],
        },
      });
    });

    it("names the step on a dry run too", async ({ dir }) => {
      const cwd = await aProjectWithAnEditedPasswordStep(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(result.stderr).toContain(
        `${LOGIN_FLOW_FILE} steps.password has been edited by hand, so it would be left alone.`,
      );
    });
  });

  describe("when a method was enabled after the conflict step was written", () => {
    it("reports no step as edited by hand", async ({ dir }) => {
      const cwd = await aProject(dir, {
        "default-human-user": {
          ...defaultSchema,
          "x-auth-methods": { password: { enabled: true }, passkey: { enabled: false } },
        },
      });
      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });
      await writeJson(cwd, SCHEMA_FILE, {
        ...defaultSchema,
        $id: schemaIdOf("default-human-user"),
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE));
      });

      expect(result.stdout).not.toContain(HAND_EDITED);
    });

    it("offers the newly enabled method on the conflict step", async ({ dir }) => {
      const cwd = await aProject(dir, {
        "default-human-user": {
          ...defaultSchema,
          "x-auth-methods": { password: { enabled: true }, passkey: { enabled: false } },
        },
      });
      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });
      await writeJson(cwd, SCHEMA_FILE, {
        ...defaultSchema,
        $id: schemaIdOf("default-human-user"),
      });

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE));
      });

      expect(await readJson(cwd, LOGIN_FLOW_FILE)).toMatchObject({
        steps: expect.arrayContaining([
          expect.objectContaining({
            name: "sso-conflict",
            actions: expect.arrayContaining([expect.objectContaining({ name: "passkey" })]),
          }),
        ]),
      });
    });
  });

  describe("with a custom provider", () => {
    it.for(["Acme SSO is set up", "Sign in once with Acme SSO"])(
      "says %s",
      async (line, { dir }) => {
        const cwd = await aProject(dir);

        const result = await withStdin(SECRET, () => {
          return runCliForTest(authMethodText(cwd, ...ACME, "--client-id", ACME_CLIENT_ID));
        });

        expect(result.stdout).toContain(line);
      },
    );
  });

  describe("when the schema defines nothing the provider maps", () => {
    it("warns that the connection has no claim mapping", async ({ dir }) => {
      const cwd = await aProject(dir, {
        "default-human-user": { ...defaultSchema, properties: { staffNumber: { type: "string" } } },
      });
      const flow = withStep(
        withStep(loginFlow("default-human-user"), "identifier", collectingStaffNumber),
        "register",
        collectingStaffNumber,
      );
      await writeJson(cwd, LOGIN_FLOW_FILE, flow);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...ACME, "--client-id", ACME_CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        warnings: expect.arrayContaining([expect.stringContaining("has no claim_mapping")]),
      });
    });
  });

  describe("when rerun on a configured Project", () => {
    it("reuses the connection", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: { connection: { action: "reuse" } },
      });
    });

    it("leaves the connection file as it was", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);
      const before = await readFile(join(cwd, CONNECTION_FILE), "utf8");

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE));
      });

      expect(await readFile(join(cwd, CONNECTION_FILE), "utf8")).toBe(before);
    });

    it("reuses the connection given the same client id, which the file only references", async ({
      dir,
    }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        data: { connection: { action: "reuse" } },
      });
    });

    it("publishes a different client id rather than ignoring it", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", OTHER_CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        data: { connection: { action: "reuse" }, client_id: { variable: "GOOGLE_CLIENT_ID" } },
      });
    });

    it("says the connection is already in the project", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE));
      });

      expect(result.stdout).toContain("In your project.");
    });

    it("does not offer a deploy, since nothing changed", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE));
      });

      expect(result.stdout).not.toContain("Deploy the configuration");
    });

    it("prints the callback URI to register, without --json", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodText(cwd, ...GOOGLE));
      });

      expect(result.stdout).toContain(CALLBACK_URI);
    });
  });

  describe("with more than one schema", () => {
    it.for(["customers", "employees"])(
      "names the %s schema when none is chosen",
      async (name, { dir }) => {
        const cwd = await aProject(dir, { customers: defaultSchema, employees: defaultSchema });

        const result = await withStdin(SECRET, () => {
          return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
        });

        expect(parseJson(result.stdout)).toMatchObject({
          status: "error",
          hint: expect.stringContaining(name),
        });
      },
    );

    it("changes the schema --schema names", async ({ dir }) => {
      const cwd = await aProject(dir, { customers: defaultSchema, employees: defaultSchema });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(
          authMethodJson(cwd, ...GOOGLE, "--schema", "employees", "--client-id", CLIENT_ID),
        );
      });

      expect(parseJson(result.stdout)).toMatchObject({ data: { schema: "employees" } });
    });
  });

  describe("when a second schema is configured with the connection already on disk", () => {
    it.for(["customers", "employees"])(
      "enables the provider on the %s schema rather than reporting a no-op",
      async (name, { dir }) => {
        const cwd = await aProject(dir, { customers: defaultSchema, employees: defaultSchema });
        await withStdin(SECRET, () => {
          return runCliForTest(
            authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--schema", "customers"),
          );
        });

        await withStdin(SECRET, () => {
          return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--schema", "employees"));
        });

        expect(await readJson(cwd, `.zitadel/schemas/${name}.json`)).toMatchObject({
          "x-auth-methods": { sso: { providers: ["google"] } },
        });
      },
    );

    it.for(["customers", "employees"])(
      "offers the provider on the %s login flow's entry step",
      async (name, { dir }) => {
        const cwd = await aProject(dir, { customers: defaultSchema, employees: defaultSchema });
        await withStdin(SECRET, () => {
          return runCliForTest(
            authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--schema", "customers"),
          );
        });

        await withStdin(SECRET, () => {
          return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--schema", "employees"));
        });

        expect(await readJson(cwd, `.zitadel/flows/${name}-login.json`)).toMatchObject({
          steps: expect.arrayContaining([
            expect.objectContaining({ name: "identifier", sso_providers: ["google"] }),
          ]),
        });
      },
    );
  });

  describe("with --dry-run", () => {
    it("reports the run as skipped", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({ status: "skipped" });
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });

    it("lists the files it would change", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({ data: { changed: CHANGED } });
    });

    it("lists the credentials it would store", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: { would_store: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
      });
    });
  });

  describe("with --dry-run and no credentials", () => {
    it.for([
      "Google needs an OAuth application.",
      `Callback URI   ${CALLBACK_URI}`,
      "Create it at   https://console.cloud.google.com/apis/credentials",
      `Would write ${CONNECTION_FILE}`,
      `Would write ${SCHEMA_FILE}`,
      `Would write ${LOGIN_FLOW_FILE}`,
      "Would store GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the project",
    ])("says %s", async (line, { dir }) => {
      const cwd = await aProject(dir);

      const result = await runCliForTest(authMethodText(cwd, ...GOOGLE, "--dry-run"));

      expect(result.stdout).toContain(line);
    });

    it("publishes nothing", async ({ dir }) => {
      const cwd = await aProject(dir);
      const publish = vi.fn(() => {
        return HttpResponse.json({});
      });
      platform.use(http.patch("*/variables", publish));

      await runCliForTest(authMethodText(cwd, ...GOOGLE, "--dry-run"));

      expect(publish).not.toHaveBeenCalled();
    });

    it("leaves the schema as it was", async ({ dir }) => {
      const cwd = await aProject(dir);
      const before = await readFile(join(cwd, SCHEMA_FILE), "utf8");

      await runCliForTest(authMethodText(cwd, ...GOOGLE, "--dry-run"));

      expect(await readFile(join(cwd, SCHEMA_FILE), "utf8")).toBe(before);
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);

      await runCliForTest(authMethodText(cwd, ...GOOGLE, "--dry-run"));

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });
  });

  describe("with --dry-run on a configured Project", () => {
    it.for([`Callback URI   ${CALLBACK_URI}`, "Would store GOOGLE_CLIENT_ID on the project"])(
      "says %s",
      async (line, { dir }) => {
        const cwd = await aProjectWithGoogle(dir);

        const result = await withStdin(SECRET, () => {
          return runCliForTest(
            authMethodText(cwd, ...GOOGLE, "--client-id", OTHER_CLIENT_ID, "--dry-run"),
          );
        });

        expect(result.stdout).toContain(line);
      },
    );

    it.for(["needs an OAuth application", `Would write ${CONNECTION_FILE}`])(
      "does not say %s",
      async (line, { dir }) => {
        const cwd = await aProjectWithGoogle(dir);

        const result = await withStdin(SECRET, () => {
          return runCliForTest(
            authMethodText(cwd, ...GOOGLE, "--client-id", OTHER_CLIENT_ID, "--dry-run"),
          );
        });

        expect(result.stdout).not.toContain(line);
      },
    );

    it("would store only the credential it was given", async ({ dir }) => {
      const cwd = await aProjectWithGoogle(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(
          authMethodJson(cwd, ...GOOGLE, "--client-id", OTHER_CLIENT_ID, "--dry-run"),
        );
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: { would_store: ["GOOGLE_CLIENT_ID"] },
      });
    });
  });

  describe("with --dry-run for a custom provider", () => {
    it.for([
      "Callback URI   http://localhost:3000/__nextgen/idp/acme-sso/callback",
      "Register it as a client at https://sso.acme.example, with the callback URI above.",
      "Would write .zitadel/idps/acme-sso.json",
      "Would store ACME_SSO_CLIENT_ID and ACME_SSO_CLIENT_SECRET on the project",
    ])("says %s", async (line, { dir }) => {
      const cwd = await aProject(dir);

      const result = await runCliForTest(authMethodText(cwd, ...ACME, "--dry-run"));

      expect(result.stdout).toContain(line);
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);

      await runCliForTest(authMethodText(cwd, ...ACME, "--dry-run"));

      expect(existsSync(join(cwd, ".zitadel/idps/acme-sso.json"))).toBe(false);
    });
  });

  describe("with no client id to ask for", () => {
    it("refuses, naming --client-id", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "error",
        hint: expect.stringContaining("--client-id"),
      });
    });

    it("keeps the run's server in the retry it suggests", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(
          authMethodJson(cwd, ...GOOGLE, "--server", "https://api.zitadel.cloud"),
        );
      });

      expect(parseJson(result.stdout)).toMatchObject({
        next_commands: [
          expect.stringContaining(
            "auth-method sso enable --provider google --client-id <client-id> --server https://api.zitadel.cloud",
          ),
        ],
      });
    });
  });

  describe("with a blank --client-id", () => {
    it("refuses it rather than taking it as one", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", "   "));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("--client-id"),
      });
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", "   "));
      });

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });
  });

  describe("with no provider", () => {
    it("refuses, naming the next move", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin(undefined, () => {
        return runCliForTest(["auth-method", "sso", "enable", "--cwd", cwd, "--json"]);
      });

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        hint: expect.stringContaining("--provider google"),
      });
    });
  });

  describe("with nothing piped in", () => {
    it("refuses, naming stdin", async ({ dir }) => {
      const cwd = await aProject(dir);

      const result = await withStdin("", () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        hint: expect.stringContaining("stdin"),
      });
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);

      await withStdin("", () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });
  });

  describe("with a hand-written connection", () => {
    it("refuses a client id other than the literal one it holds", async ({ dir }) => {
      const cwd = await aProjectWithAHandWrittenConnection(dir, { client_id: "literal-one" });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", "a-different-one"));
      });

      expect(parseJson(result.stdout)).toMatchObject({ code: "E_VALIDATION" });
    });

    it("publishes to the variables the connection names", async ({ dir }) => {
      const cwd = await aProjectWithAHandWrittenConnection(dir, {
        client_id: "${{ ACME_GOOGLE_ID }}",
        client_secret: "${{ ACME_GOOGLE_SECRET }}",
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        data: {
          client_id: { variable: "ACME_GOOGLE_ID" },
          secret: { variable: "ACME_GOOGLE_SECRET" },
        },
      });
    });
  });

  describe("when an earlier run was interrupted after writing the connection", () => {
    it("enables the provider on the schema", async ({ dir }) => {
      const cwd = await aProjectWithAHandWrittenConnection(dir, { client_id: "abc" });

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE));
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toMatchObject({
        "x-auth-methods": { sso: { enabled: true } },
      });
    });
  });

  describe("when no login flow runs against the schema", () => {
    it("refuses, naming where flows live", async ({ dir }) => {
      const cwd = await aProject(dir);
      await rm(join(cwd, LOGIN_FLOW_FILE));

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_NOT_FOUND",
        hint: expect.stringContaining(".zitadel/flows/"),
      });
    });

    it("refuses a dry run for the same reason", async ({ dir }) => {
      const cwd = await aProject(dir);
      await rm(join(cwd, LOGIN_FLOW_FILE));

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({ code: "E_NOT_FOUND" });
    });

    it("leaves the schema as it was", async ({ dir }) => {
      const cwd = await aProject(dir);
      await rm(join(cwd, LOGIN_FLOW_FILE));
      const before = await readFile(join(cwd, SCHEMA_FILE), "utf8");

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(await readFile(join(cwd, SCHEMA_FILE), "utf8")).toBe(before);
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);
      await rm(join(cwd, LOGIN_FLOW_FILE));

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });
  });

  describe("when the schemas directory cannot be listed", () => {
    it("refuses, without reporting it as holding no schemas", async ({ dir }) => {
      const cwd = await aProject(dir);
      await rm(join(cwd, ".zitadel/schemas"), { recursive: true });
      await writeFile(join(cwd, ".zitadel/schemas"), "not a directory");

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        status: "error",
        code: expect.not.stringMatching(/^E_NOT_FOUND$/),
      });
    });
  });

  describe("when the flow names the schema by its objectType", () => {
    it("offers the provider on that flow", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: {
          "default-human-user": {
            ...defaultSchema,
            $id: "https://a.example/default-human-user.json",
            objectType: "human-user",
          },
        },
        flows: {
          "default-human-user-login": {
            ...loginFlow("default-human-user"),
            user_schema: "human-user",
          },
        },
        linked: true,
      });

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(await readJson(cwd, LOGIN_FLOW_FILE)).toMatchObject({
        steps: expect.arrayContaining([
          expect.objectContaining({ name: "identifier", sso_providers: ["google"] }),
        ]),
      });
    });
  });

  describe("when the only flow names a different schema with the same file name", () => {
    it("refuses rather than wire the provider into the wrong sign-in", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: {
          "default-human-user": {
            ...defaultSchema,
            $id: "https://a.example/default-human-user.json",
          },
        },
        flows: {
          "default-human-user-login": {
            ...loginFlow("default-human-user"),
            user_schema: "https://b.example/default-human-user.json",
          },
        },
        linked: true,
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({ code: "E_NOT_FOUND" });
    });
  });

  describe("when the flow cannot be checked against the changed schema", () => {
    it("refuses, saying so", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        purposes: { login: "missing" },
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        message: expect.stringContaining("cannot be checked against the changed schema"),
      });
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        purposes: { login: "missing" },
      });

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });

    it("refuses a dry run too", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        purposes: { login: "missing" },
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({ code: "E_VALIDATION" });
    });
  });

  describe("when saving would refuse the connection's path", () => {
    /**
     * A Project whose connections directory leads outside `.zitadel/`.
     *
     * @param dir - The directory to write the Project into.
     * @returns The Project's directory.
     */
    async function aProjectWithAnEscapingConnectionsDirectory(dir: string): Promise<string> {
      const cwd = await aProject(dir);
      const outside = join(dir, "outside-idps");
      await mkdir(outside, { recursive: true });
      await symlink(outside, join(cwd, ".zitadel/idps"));
      return cwd;
    }

    it("refuses", async ({ dir }) => {
      const cwd = await aProjectWithAnEscapingConnectionsDirectory(dir);

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({ status: "error" });
    });

    it("publishes no credentials", async ({ dir }) => {
      const cwd = await aProjectWithAnEscapingConnectionsDirectory(dir);
      const publish = vi.fn(() => {
        return HttpResponse.json({});
      });
      platform.use(http.patch("*/variables", publish));

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe("when the flow's steps are not a list", () => {
    it("refuses, naming the flow file", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        steps: "broken",
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        details: { problems: [expect.objectContaining({ path: LOGIN_FLOW_FILE })] },
      });
    });

    it("leaves the flow's steps as they were rather than overwriting them", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        steps: "broken",
      });

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(await readJson(cwd, LOGIN_FLOW_FILE)).toMatchObject({ steps: "broken" });
    });

    it("writes no connection", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        steps: "broken",
      });

      await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(existsSync(join(cwd, CONNECTION_FILE))).toBe(false);
    });
  });

  describe("when no active flow offers a way to sign in", () => {
    it("warns that nobody can sign in", async ({ dir }) => {
      const cwd = await aProject(dir);
      await writeJson(cwd, LOGIN_FLOW_FILE, {
        ...loginFlow("default-human-user"),
        status: "draft",
      });

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID, "--dry-run"));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        warnings: expect.arrayContaining([
          "No active login flow for default-human-user offers a method it enables, so nobody can sign in until one does.",
        ]),
      });
    });
  });

  describe("when the Project's path needs quoting", () => {
    it("leaves the follow-ups out of next_commands", async ({ dir }) => {
      const cwd = await aProject(join(dir, "my project"));

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({ data: { next_commands: [] } });
    });

    it("still lists them as next_args", async ({ dir }) => {
      const cwd = await aProject(join(dir, "my project"));

      const result = await withStdin(SECRET, () => {
        return runCliForTest(authMethodJson(cwd, ...GOOGLE, "--client-id", CLIENT_ID));
      });

      expect(parseJson(result.stdout)).toMatchObject({
        data: { next_args: expect.arrayContaining([expect.arrayContaining(["--cwd"])]) },
      });
    });
  });
});
