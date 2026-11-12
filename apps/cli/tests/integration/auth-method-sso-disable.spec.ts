import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import {
  aSetUpApp,
  type CustomConnection,
  MOCK_SERVER_URL,
  type ScaffoldedApp,
} from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

/**
 * The catalog provider the project serves.
 */
const GOOGLE = "google";

/**
 * Google's client id and secret.
 */
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/**
 * A connection the catalog does not list, described by the developer.
 */
const ACME: CustomConnection = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};

/**
 * The custom connection's client id and secret.
 */
const ACME_CREDENTIALS = { clientId: "acme-client-id", secret: "acme-client-secret" };

/**
 * A provider neither the catalog nor a connection names.
 */
const UNKNOWN_PROVIDER = "gogle";

/**
 * What a project's files look like after a command that wrote nothing.
 */
const NO_CHANGES = { added: [], modified: [], removed: [] };

/**
 * The schema the commands change, and the file it lives in.
 */
const SCHEMA = "default-human-user";
const SCHEMA_FILE = ".zitadel/schemas/default-human-user.json";

/**
 * The login flow that offers the provider.
 */
const FLOW_FILE = ".zitadel/flows/default-login.json";

/**
 * A provider name no connection holds, with an escape sequence in it.
 */
const HOSTILE_PROVIDER = "go\u001b[31mgle";

/**
 * What the command asks before it removes the last way to sign in.
 */
const QUESTION = "Disable google anyway? Nobody will be able to sign in to default-human-user.";

/**
 * What the command warns when it left the schema with no way to sign in.
 */
const LEFT_WITH_NONE_WARNING =
  "default-human-user is left with no way to sign in. Its users can only be managed through the API.";

/**
 * What the dry run warns of the same.
 */
const WOULD_LEAVE_NONE_WARNING =
  "default-human-user would be left with no way to sign in. Its users can only be managed through the API.";

/**
 * What the command says of the steps a removed provider leaves behind.
 */
const STEPS_STAY_NOTICE = {
  severity: "info",
  message: `The steps register-sso and sso-conflict stay in ${FLOW_FILE} for the next provider you enable.`,
};

/**
 * What the command says of the connection and variables Google leaves behind.
 */
const GOOGLE_STAYS_NOTICE = {
  severity: "info",
  message:
    ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay, so enabling google again does not ask for its credentials. Deploys publish the connection until you delete the file; the server keeps it either way, as deleting a connection is not supported yet.",
};

/**
 * What the command says of the connection and variables the Acme connection leaves behind.
 */
const ACME_STAYS_NOTICE = {
  severity: "info",
  message:
    ".zitadel/idps/acme-sso.json and the project variables ACME_SSO_CLIENT_ID and ACME_SSO_CLIENT_SECRET stay, so enabling acme-sso again does not ask for its credentials. Deploys publish the connection until you delete the file; the server keeps it either way, as deleting a connection is not supported yet.",
};

/**
 * A set-up project serving Google, deployed.
 *
 * @returns The project.
 */
async function anAppServingGoogle(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasEnabledSso(GOOGLE, CREDENTIALS);
  await app.publishData();
  return app;
}

/**
 * A set-up project serving a custom connection, deployed.
 *
 * @returns The project.
 */
async function anAppServingAcme(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasEnabledCustomSso(ACME, ACME_CREDENTIALS);
  await app.publishData();
  return app;
}

describe("auth-method sso disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still removes the provider, because it never reaches for the server", async () => {
        const app = await anAppServingGoogle();
        platform.isNotZitadel();

        const result = await app.disableSso(GOOGLE);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still removes the provider, because it never reaches for the server", async () => {
        const app = await anAppServingGoogle();
        platform.isUnavailable();

        const result = await app.disableSso(GOOGLE);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "sso", "disable", "--provider", GOOGLE, "--force"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("removes the provider", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSso(GOOGLE);

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:sso:disable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "sso",
            provider: GOOGLE,
            changed: [SCHEMA_FILE, FLOW_FILE],
            usable: ["passkey", "password"],
            notices: [GOOGLE_STAYS_NOTICE, STEPS_STAY_NOTICE],
            title: "Removed google from default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--cwd", app.path],
              ["deploy", "-m", "<what changed>", "--cwd", app.path],
            ],
            next_actions: [
              "To stop publishing the connection, delete .zitadel/idps/google.json before the deploy below.",
              `Once that deploy is live, remove its credentials: ${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_ID --server ${MOCK_SERVER_URL} --cwd ${app.path}`)} and ${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_SECRET --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
            ],
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy -m '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("removes a custom connection named by its slug", async () => {
        const app = await anAppServingAcme();

        const result = await app.disableSso(ACME.slug);

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:sso:disable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "sso",
            provider: ACME.slug,
            changed: [SCHEMA_FILE, FLOW_FILE],
            usable: ["passkey", "password"],
            notices: [ACME_STAYS_NOTICE, STEPS_STAY_NOTICE],
            title: "Removed acme-sso from default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--cwd", app.path],
              ["deploy", "-m", "<what changed>", "--cwd", app.path],
            ],
            next_actions: [
              "To stop publishing the connection, delete .zitadel/idps/acme-sso.json before the deploy below.",
              `Once that deploy is live, remove its credentials: ${expectedPublicCliCommand(`variable rm ACME_SSO_CLIENT_ID --server ${MOCK_SERVER_URL} --cwd ${app.path}`)} and ${expectedPublicCliCommand(`variable rm ACME_SSO_CLIENT_SECRET --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
            ],
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy -m '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("removes the provider when it was the last way to sign in and --force was given", async () => {
        const app = await anAppServingGoogle();
        await app.signsInOnlyWithSso(GOOGLE);

        const result = await app.disableSso(GOOGLE, ["--force"]);

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:sso:disable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "sso",
            provider: GOOGLE,
            changed: [SCHEMA_FILE],
            usable: [],
            notices: [
              GOOGLE_STAYS_NOTICE,
              { severity: "warning", message: LEFT_WITH_NONE_WARNING },
            ],
            title: "Removed google from default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--cwd", app.path],
              ["deploy", "-m", "<what changed>", "--cwd", app.path],
            ],
            next_actions: [
              "To stop publishing the connection, delete .zitadel/idps/google.json before the deploy below.",
              `Once that deploy is live, remove its credentials: ${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_ID --server ${MOCK_SERVER_URL} --cwd ${app.path}`)} and ${expectedPublicCliCommand(`variable rm GOOGLE_CLIENT_SECRET --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
            ],
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy -m '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [LEFT_WITH_NONE_WARNING],
        });
      });

      it("leaves the change for deploy to publish", async () => {
        const app = await anAppServingGoogle();

        await app.disableSso(GOOGLE);

        expect(await app.publishedAuthMethods()).toHaveProperty("sso.enabled", true);
      });

      it("refuses a run that names no provider", async () => {
        const app = await anAppServingGoogle();

        const result = await app.run([
          "auth-method",
          "sso",
          "disable",
          "--non-interactive",
          "--json",
        ]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "auth-method:sso:disable",
          source: "",
          code: "E_VALIDATION",
          message: "Name the provider to remove",
          hint: "Pass --provider, e.g. --provider google. default-human-user offers: google.",
        });
      });

      describe("removing the last way to sign in without --force when no one can be asked", () => {
        it("is refused, with the question and the commands that go on", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            code: "E_CONFIRMATION_REQUIRED",
            message: `${SCHEMA_FILE} would have no way to sign in left`,
            hint: `Enable another method first, such as ${expectedPublicCliCommand("auth-method sso enable --provider '<name>'")}. If the schema's users are only managed through the API, ask a person first: ${QUESTION} Re-run with --force only once they agree (the first of details.suggested_args holds the exact arguments).`,
            next_commands: [
              expectedPublicCliCommand(
                `auth-method sso disable --provider google --schema ${SCHEMA} --cwd ${app.path} --force`,
              ),
              expectedPublicCliCommand(
                `auth-method password enable --schema ${SCHEMA} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `auth-method passkey enable --schema ${SCHEMA} --cwd ${app.path}`,
              ),
            ],
            details: {
              question: QUESTION,
              file: SCHEMA_FILE,
              usable: ["sso"],
              suggested_args: [
                [
                  "auth-method",
                  "sso",
                  "disable",
                  "--provider",
                  GOOGLE,
                  "--schema",
                  SCHEMA,
                  "--cwd",
                  app.path,
                  "--force",
                ],
                ["auth-method", "password", "enable", "--schema", SCHEMA, "--cwd", app.path],
                ["auth-method", "passkey", "enable", "--schema", SCHEMA, "--cwd", app.path],
              ],
            },
          });
        });

        it("keeps a dry run a dry run in the command it suggests", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE, ["--dry-run"]);

          expect(result).toSuggest(
            `auth-method sso disable --provider google --schema ${SCHEMA} --cwd ${app.path} --force --dry-run`,
          );
        });

        it("says to pass --force", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(result).toSuggest(
            `auth-method sso disable --provider google --schema ${SCHEMA} --cwd ${app.path} --force`,
          );
        });

        it("disables nothing", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);
          const files = await app.snapshot();

          await app.disableSso(GOOGLE);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("a catalog provider the project does not offer", () => {
        it("succeeds, with nothing to remove", async () => {
          const app = await aSetUpApp();

          const result = await app.disableSso(GOOGLE);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "sso",
              provider: GOOGLE,
              changed: [],
              usable: ["passkey", "password"],
              notices: [],
              title: "default-human-user does not offer google, so nothing changed",
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.disableSso(GOOGLE);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("a provider neither the catalog nor a connection names", () => {
        it("is refused, with the providers it does know", async () => {
          const app = await anAppServingGoogle();

          const result = await app.disableSso(UNKNOWN_PROVIDER);

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            code: "E_NOT_FOUND",
            message: "default-human-user has no provider named gogle",
            hint: "default-human-user offers: google. Connections under .zitadel/idps/: google.",
            details: {
              requested: UNKNOWN_PROVIDER,
              offered: [GOOGLE],
              connections: [GOOGLE],
            },
          });
        });

        it("is refused with the name as typed, escape sequence and all", async () => {
          const app = await anAppServingGoogle();

          const result = await app.disableSso(HOSTILE_PROVIDER);

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            code: "E_NOT_FOUND",
            message: `default-human-user has no provider named ${HOSTILE_PROVIDER}`,
            hint: "default-human-user offers: google. Connections under .zitadel/idps/: google.",
            details: {
              requested: HOSTILE_PROVIDER,
              offered: [GOOGLE],
              connections: [GOOGLE],
            },
          });
        });

        it("changes nothing", async () => {
          const app = await anAppServingGoogle();
          const files = await app.snapshot();

          await app.disableSso(UNKNOWN_PROVIDER);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("a provider already disabled", () => {
        it("succeeds again, with nothing to remove", async () => {
          const app = await anAppServingGoogle();
          await app.hasDisabledSso(GOOGLE);

          const result = await app.disableSso(GOOGLE);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "sso",
              provider: GOOGLE,
              changed: [],
              usable: ["passkey", "password"],
              notices: [],
              title: "default-human-user does not offer google, so nothing changed",
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
        });

        it("changes nothing", async () => {
          const app = await anAppServingGoogle();
          await app.hasDisabledSso(GOOGLE);
          const files = await app.snapshot();

          await app.disableSso(GOOGLE);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("under --dry-run", () => {
        it("previews removing the provider, and the command that does", async () => {
          const app = await anAppServingGoogle();

          const result = await app.disableSso(GOOGLE, ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "sso",
              provider: GOOGLE,
              changed: [SCHEMA_FILE, FLOW_FILE],
              usable: ["passkey", "password"],
              notices: [GOOGLE_STAYS_NOTICE, STEPS_STAY_NOTICE],
              title: "Would remove google from default-human-user (dry run)",
              dry_run: true,
              next_args: [
                ["auth-method", "sso", "disable", "--provider", GOOGLE, "--cwd", app.path],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method sso disable --provider google --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("previews removing the last way to sign in, and keeps --force in the command that does", async () => {
          const app = await anAppServingGoogle();
          await app.signsInOnlyWithSso(GOOGLE);

          const result = await app.disableSso(GOOGLE, ["--dry-run", "--force"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "sso",
              provider: GOOGLE,
              changed: [SCHEMA_FILE],
              usable: [],
              notices: [
                GOOGLE_STAYS_NOTICE,
                { severity: "warning", message: WOULD_LEAVE_NONE_WARNING },
              ],
              title: "Would remove google from default-human-user (dry run)",
              dry_run: true,
              next_args: [
                [
                  "auth-method",
                  "sso",
                  "disable",
                  "--provider",
                  GOOGLE,
                  "--cwd",
                  app.path,
                  "--force",
                ],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method sso disable --provider google --cwd ${app.path} --force`,
                ),
              ],
            },
            warnings: [WOULD_LEAVE_NONE_WARNING],
          });
        });

        it("writes nothing", async () => {
          const app = await anAppServingGoogle();
          const files = await app.snapshot();

          await app.disableSso(GOOGLE, ["--dry-run"]);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("still offers the provider afterwards", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE, ["--dry-run"]);

          expect(await app.disableSso(GOOGLE)).toSucceed();
        });

        it("says nothing would change when the project does not offer the provider", async () => {
          const app = await aSetUpApp();

          const result = await app.disableSso(GOOGLE, ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:sso:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "sso",
              provider: GOOGLE,
              changed: [],
              usable: ["passkey", "password"],
              notices: [],
              title: "default-human-user does not offer google, so nothing would change (dry run)",
              dry_run: true,
              next_args: [
                ["auth-method", "sso", "disable", "--provider", GOOGLE, "--cwd", app.path],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method sso disable --provider google --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });
      });

      describe("once deployed", () => {
        it("publishes SSO as off", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("sso", { enabled: false });
        });

        it("stops offering the provider on any step", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          expect(await app.stepsOfferingSsoOnceDeployed()).toEqual([]);
        });

        it("keeps the connection, so enabling it again needs no credentials", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          expect(await app.registeredIdpSlugsOnceDeployed()).toEqual([GOOGLE]);
        });

        it("removes a custom connection named by its slug", async () => {
          const app = await anAppServingAcme();

          await app.disableSso(ACME.slug);

          expect(await app.stepsOfferingSsoOnceDeployed()).toEqual([]);
        });

        it("leaves nothing left to deploy", async () => {
          const app = await anAppServingGoogle();

          await app.disableSso(GOOGLE);

          const [first, again] = await app.releasesOfTwoDeploys();
          expect(again).toBe(first);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says which provider it removed, and from which schema", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrint("Removed google from default-human-user");
      });

      it("says what it removed, as the envelope titles it", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result.stdout.split("\n")).toContain("Removed google from default-human-user");
      });

      it("says there was nothing to remove", async () => {
        const app = await aSetUpApp();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrint("default-human-user does not offer google, so nothing changed");
      });

      it("suggests deploying the change", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrint(`deploy --dry-run --cwd ${app.path}`);
      });

      it("tells how to remove the connection and its credentials", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrint(
          "To stop publishing the connection, delete .zitadel/idps/google.json before the deploy below.",
        );
      });

      it("says what it kept once", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toSayOnce(GOOGLE_STAYS_NOTICE.message);
      });

      it("warns once when it left no way to sign in", async () => {
        const app = await anAppServingGoogle();
        await app.signsInOnlyWithSso(GOOGLE);

        const result = await app.run([
          "auth-method",
          "sso",
          "disable",
          "--non-interactive",
          "--provider",
          GOOGLE,
          "--force",
        ]);

        expect(result).toSayOnce(LEFT_WITH_NONE_WARNING);
      });

      it("says what it would remove on a dry run, as the envelope titles it", async () => {
        const app = await anAppServingGoogle();

        const result = await app.run([
          "auth-method",
          "sso",
          "disable",
          "--non-interactive",
          "--dry-run",
          "--provider",
          GOOGLE,
        ]);

        expect(result.stdout.split("\n")).toContain(
          "Would remove google from default-human-user (dry run)",
        );
      });

      it("prints the question and the commands that go on when it needs --force", async () => {
        const app = await anAppServingGoogle();
        await app.signsInOnlyWithSso(GOOGLE);

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toSay(
          `${QUESTION} Re-run with --force only once they agree.\n\nNext:\n  $ ${expectedPublicCliCommand(`auth-method sso disable --provider google --schema ${SCHEMA} --cwd ${app.path} --force`)}\n  $ ${expectedPublicCliCommand(`auth-method password enable --schema ${SCHEMA} --cwd ${app.path}`)}\n  $ ${expectedPublicCliCommand(`auth-method passkey enable --schema ${SCHEMA} --cwd ${app.path}`)}`,
        );
      });

      it("spells out the escape sequence in a provider name it refuses", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(HOSTILE_PROVIDER);

        expect(result).toSay("named go\\x1b[31mgle");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrintNoJson();
      });
    });
  });
});
