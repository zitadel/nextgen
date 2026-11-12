import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
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

describe("auth-method password enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.enableMethod("password");

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.enableMethod("password");

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "password", "enable"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("turns password on after it was switched off by hand", async () => {
        const app = await aSetUpApp();
        await app.hasTurnedOffByHand("password");

        const result = await app.enableMethod("password");

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:password:enable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "password",
            changed: [SCHEMA_FILE],
            usable: ["passkey", "password"],
            not_offered: [],
            notices: [],
            title: "Enabled password for default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--cwd", app.path],
              ["deploy", "-m", "<what changed>", "--cwd", app.path],
            ],
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy -m '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [],
        });
      });

      it("refuses a schema with no x-identifier to check a password against", async () => {
        const app = await aSetUpApp();
        await app.lacksAnIdentifier();
        await app.hasTurnedOffByHand("password");

        const result = await app.enableMethod("password");

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "auth-method:password:enable",
          source: "",
          code: "E_VALIDATION",
          message: `${SCHEMA_FILE} has no x-identifier for password`,
          hint: 'A password is checked against the user found by the schema\'s identifier. Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
          details: { file: SCHEMA_FILE, method: "password" },
        });
      });

      it("writes nothing for a schema with no x-identifier", async () => {
        const app = await aSetUpApp();
        await app.lacksAnIdentifier();
        await app.hasTurnedOffByHand("password");
        const files = await app.snapshot();

        await app.enableMethod("password");

        expect(await files.changes()).toMatchObject(NO_CHANGES);
      });

      it("refuses a schema the project does not hold, with its name as typed", async () => {
        const app = await aSetUpApp();

        const result = await app.enableMethod("password", ["--schema", HOSTILE_SCHEMA]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "auth-method:password:enable",
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

      describe("under --dry-run", () => {
        it("previews turning password on, and the command that does", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");

          const result = await app.enableMethod("password", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [SCHEMA_FILE],
              usable: ["passkey", "password"],
              not_offered: [],
              notices: [],
              title: "Would enable password for default-human-user (dry run)",
              dry_run: true,
              next_args: [["auth-method", "password", "enable", "--cwd", app.path]],
              next_commands: [
                expectedPublicCliCommand(`auth-method password enable --cwd ${app.path}`),
              ],
            },
            warnings: [],
          });
        });

        it("writes nothing", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");
          const files = await app.snapshot();

          await app.enableMethod("password", ["--dry-run"]);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("keeps the schema it was told to change in the command that does", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");

          const result = await app.enableMethod("password", ["--dry-run", "--schema", SCHEMA]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [SCHEMA_FILE],
              usable: ["passkey", "password"],
              not_offered: [],
              notices: [],
              title: "Would enable password for default-human-user (dry run)",
              dry_run: true,
              next_args: [
                ["auth-method", "password", "enable", "--schema", SCHEMA, "--cwd", app.path],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method password enable --schema ${SCHEMA} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("says there is nothing to enable when password is already on", async () => {
          const app = await aSetUpApp();

          const result = await app.enableMethod("password", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [],
              usable: ["passkey", "password"],
              not_offered: [],
              notices: [],
              title: "Nothing to enable for default-human-user (dry run)",
              dry_run: true,
              next_args: [["auth-method", "password", "enable", "--cwd", app.path]],
              next_commands: [
                expectedPublicCliCommand(`auth-method password enable --cwd ${app.path}`),
              ],
            },
            warnings: [],
          });
        });
      });

      describe("when password is already on", () => {
        it("succeeds, with nothing to enable", async () => {
          const app = await aSetUpApp();

          const result = await app.enableMethod("password");

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:enable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [],
              usable: ["passkey", "password"],
              not_offered: [],
              notices: [],
              title: "Nothing to enable for default-human-user",
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.enableMethod("password");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("leaves nothing to publish", async () => {
          const app = await aSetUpApp();
          const before = await app.publishData();

          await app.enableMethod("password");

          expect((await app.deployData()).content_hash).toBe(before.content_hash);
        });
      });

      describe("once deployed", () => {
        it("publishes password as on after it was switched off by hand", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");

          await app.enableMethod("password");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("password", {
            enabled: true,
          });
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says there was nothing to enable", async () => {
        const app = await aSetUpApp();

        const result = await app.enableMethodRendered("password");

        expect(result).toPrint("Nothing to enable for default-human-user");
      });

      it("says what it enabled, as the envelope titles it", async () => {
        const app = await aSetUpApp();
        await app.hasTurnedOffByHand("password");

        const result = await app.enableMethodRendered("password");

        expect(result.stdout.split("\n")).toContain("Enabled password for default-human-user");
      });

      it("suggests deploying the change", async () => {
        const app = await aSetUpApp();
        await app.hasTurnedOffByHand("password");

        const result = await app.enableMethodRendered("password");

        expect(result).toPrint(`deploy --dry-run --cwd ${app.path}`);
      });

      it("says what it would enable on a dry run, as the envelope titles it", async () => {
        const app = await aSetUpApp();
        await app.hasTurnedOffByHand("password");

        const result = await app.run([
          "auth-method",
          "password",
          "enable",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result.stdout.split("\n")).toContain(
          "Would enable password for default-human-user (dry run)",
        );
      });

      it("spells out the escape sequence in a schema name it refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "auth-method",
          "password",
          "enable",
          "--non-interactive",
          "--schema",
          HOSTILE_SCHEMA,
        ]);

        expect(result).toSay("named no\\x1b[31mpe");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.enableMethodRendered("password");

        expect(result).toPrintNoJson();
      });
    });
  });
});
