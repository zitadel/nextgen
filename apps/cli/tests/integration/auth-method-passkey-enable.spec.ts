import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";

const platform = usePlatformMock();

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
 * A schema name no project holds, with an escape sequence in it.
 */
const HOSTILE_SCHEMA = "no\u001b[31mpe";

/**
 * What the command warns when passkey is on but no login flow offers it.
 */
const NOT_OFFERED_WARNING =
  'No login flow for default-human-user offers passkey yet. In .zitadel/flows/default-login.json, add a "kind": "passkey" action to a step reached from purposes.login, plus a transition under the action\'s name. A "kind": "passkey_register" action does the same for sign-up. See .zitadel/flows/README.md.';

/**
 * A set-up project with passkey turned off, so enabling it has something to do.
 *
 * @returns The project.
 */
async function anAppWithoutPasskey(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  await app.hasDisabledMethod("passkey");
  return app;
}

describe("auth-method passkey enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns passkey on, because it never reaches for the server", async () => {
        const app = await anAppWithoutPasskey();
        platform.isNotZitadel();

        const result = await app.enableMethod("passkey");

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still turns passkey on, because it never reaches for the server", async () => {
        const app = await anAppWithoutPasskey();
        platform.isUnavailable();

        const result = await app.enableMethod("passkey");

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "passkey", "enable"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("turns passkey on", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethod("passkey");

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:passkey:enable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "passkey",
            changed: [SCHEMA_FILE],
            usable: ["passkey", "password"],
            not_offered: ["passkey"],
            notices: [{ severity: "warning", message: NOT_OFFERED_WARNING }],
            title: "Enabled passkey for default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--cwd", app.path],
              ["deploy", "--message", "<what changed>", "--cwd", app.path],
            ],
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy --message '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [NOT_OFFERED_WARNING],
        });
      });

      it("leaves the change for deploy to publish", async () => {
        const app = await anAppWithoutPasskey();
        await app.publishData();

        await app.enableMethod("passkey");

        expect(await app.publishedAuthMethods()).toHaveProperty("passkey", { enabled: false });
      });

      it("refuses a schema the project does not hold, with its name as typed", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethod("passkey", ["--schema", HOSTILE_SCHEMA]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "auth-method:passkey:enable",
          source: "",
          code: "E_NOT_FOUND",
          message: `This project has no user schema named ${HOSTILE_SCHEMA}`,
          hint: "Known schemas: default-human-user (human-user)",
          details: {
            requested: HOSTILE_SCHEMA,
            known: [SCHEMA],
            schemas: [{ name: SCHEMA, object_type: "human-user" }],
          },
        });
      });

      it("writes nothing for a schema the project does not hold", async () => {
        const app = await anAppWithoutPasskey();
        const files = await app.snapshot();

        await app.enableMethod("passkey", ["--schema", HOSTILE_SCHEMA]);

        expect(await files.changes()).toMatchObject(NO_CHANGES);
      });

      describe("under --dry-run", () => {
        it("previews turning passkey on, and the command that does", async () => {
          const app = await anAppWithoutPasskey();

          const result = await app.enableMethod("passkey", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [SCHEMA_FILE],
              usable: ["passkey", "password"],
              not_offered: ["passkey"],
              notices: [{ severity: "warning", message: NOT_OFFERED_WARNING }],
              title: "Would enable passkey for default-human-user (dry run)",
              dry_run: true,
              next_args: [["auth-method", "passkey", "enable", "--cwd", app.path]],
              next_commands: [
                expectedPublicCliCommand(`auth-method passkey enable --cwd ${app.path}`),
              ],
            },
            warnings: [NOT_OFFERED_WARNING],
          });
        });

        it("writes nothing", async () => {
          const app = await anAppWithoutPasskey();
          const files = await app.snapshot();

          await app.enableMethod("passkey", ["--dry-run"]);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("keeps the schema it was told to change in the command that does", async () => {
          const app = await anAppWithoutPasskey();

          const result = await app.enableMethod("passkey", ["--dry-run", "--schema", SCHEMA]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [SCHEMA_FILE],
              usable: ["passkey", "password"],
              not_offered: ["passkey"],
              notices: [{ severity: "warning", message: NOT_OFFERED_WARNING }],
              title: "Would enable passkey for default-human-user (dry run)",
              dry_run: true,
              next_args: [
                ["auth-method", "passkey", "enable", "--schema", SCHEMA, "--cwd", app.path],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method passkey enable --schema ${SCHEMA} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [NOT_OFFERED_WARNING],
          });
        });

        it("says there is nothing to enable when passkey is already on", async () => {
          const app = await aSetUpApp();

          const result = await app.enableMethod("passkey", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [],
              usable: ["passkey", "password"],
              not_offered: ["passkey"],
              notices: [{ severity: "warning", message: NOT_OFFERED_WARNING }],
              title: "Nothing to enable for default-human-user (dry run)",
              dry_run: true,
              next_args: [["auth-method", "passkey", "enable", "--cwd", app.path]],
              next_commands: [
                expectedPublicCliCommand(`auth-method passkey enable --cwd ${app.path}`),
              ],
            },
            warnings: [NOT_OFFERED_WARNING],
          });
        });
      });

      describe("when passkey is already on", () => {
        it("succeeds, with nothing to enable", async () => {
          const app = await aSetUpApp();

          const result = await app.enableMethod("passkey");

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [],
              usable: ["passkey", "password"],
              not_offered: ["passkey"],
              notices: [{ severity: "warning", message: NOT_OFFERED_WARNING }],
              title: "Nothing to enable for default-human-user",
              next_args: [],
              next_commands: [],
            },
            warnings: [NOT_OFFERED_WARNING],
          });
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.enableMethod("passkey");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("leaves nothing to publish", async () => {
          const app = await aSetUpApp();
          const before = await app.publishData();

          await app.enableMethod("passkey");

          expect((await app.deployData()).content_hash).toBe(before.content_hash);
        });
      });

      describe("once deployed", () => {
        it("publishes passkey as on", async () => {
          const app = await anAppWithoutPasskey();

          await app.enableMethod("passkey");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("passkey", { enabled: true });
        });

        it("leaves nothing left to deploy", async () => {
          const app = await anAppWithoutPasskey();

          await app.enableMethod("passkey");

          const [first, again] = await app.releasesOfTwoDeploys();
          expect(again).toBe(first);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says there was nothing to enable", async () => {
        const app = await aSetUpApp();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toPrint("Nothing to enable for default-human-user");
      });

      it("says what it enabled, as the envelope titles it", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result.stdout.split("\n")).toContain("Enabled passkey for default-human-user");
      });

      it("suggests deploying the change", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toPrint(`deploy --dry-run --cwd ${app.path}`);
      });

      it("warns once when no login flow offers passkey yet", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toSayOnce(NOT_OFFERED_WARNING);
      });

      it("says what it would enable on a dry run, as the envelope titles it", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.run([
          "auth-method",
          "passkey",
          "enable",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result.stdout.split("\n")).toContain(
          "Would enable passkey for default-human-user (dry run)",
        );
      });

      it("spells out the escape sequence in a schema name it refuses", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.run([
          "auth-method",
          "passkey",
          "enable",
          "--non-interactive",
          "--schema",
          HOSTILE_SCHEMA,
        ]);

        expect(result).toSay("named no\\x1b[31mpe");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.enableMethodRendered("passkey");

        expect(result).toPrintNoJson();
      });
    });
  });
});
