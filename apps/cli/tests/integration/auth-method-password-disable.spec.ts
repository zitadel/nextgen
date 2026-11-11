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
 * The login flow that still asks for a password.
 */
const FLOW_FILE = ".zitadel/flows/default-login.json";

/**
 * A schema name no project holds, with an escape sequence in it.
 */
const HOSTILE_SCHEMA = "no\u001b[31mpe";

/**
 * What the command asks before it removes the last way to sign in.
 */
const QUESTION = "Disable password anyway? Nobody will be able to sign in to default-human-user.";

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
 * What the command warns when no login flow offers a method the schema enables.
 */
const NO_ACTIVE_FLOW_WARNING =
  "No active login flow for default-human-user offers a method it enables, so nobody can sign in until one does.";

describe("auth-method password disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("refuses without reaching for the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.disableMethod("password");

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("refuses without reaching for the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.disableMethod("password");

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "password", "disable", "--force"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("turns password off when it was the last way to sign in and --force was given", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("password");

        const result = await app.disableMethod("password", ["--force"]);

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:password:disable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "password",
            changed: [SCHEMA_FILE],
            usable: [],
            not_offered: [],
            notices: [{ severity: "warning", message: LEFT_WITH_NONE_WARNING }],
            title: "Disabled password for default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--cwd", app.path],
              ["deploy", "-m", "<what changed>", "--cwd", app.path],
            ],
            next_commands: [
              expectedPublicCliCommand(`deploy --dry-run --cwd ${app.path}`),
              expectedPublicCliCommand(`deploy -m '<what changed>' --cwd ${app.path}`),
            ],
          },
          warnings: [LEFT_WITH_NONE_WARNING],
        });
      });

      it("refuses a schema the project does not hold, with its name as typed", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethod("password", ["--schema", HOSTILE_SCHEMA]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "auth-method:password:disable",
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

      describe("removing the last way to sign in without --force when no one can be asked", () => {
        it("is refused, with the question and the commands that go on", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");

          const result = await app.disableMethod("password");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:password:disable",
            source: "",
            code: "E_CONFIRMATION_REQUIRED",
            message: `${SCHEMA_FILE} would have no way to sign in left`,
            hint: `Enable another method first, such as ${expectedPublicCliCommand("auth-method sso enable --provider <name>")}. If the schema's users are only managed through the API, ask a person first: ${QUESTION} Re-run with --force only once they agree (the first of details.suggested_args holds the exact arguments).`,
            next_commands: [
              expectedPublicCliCommand(
                `auth-method password disable --schema ${SCHEMA} --cwd ${app.path} --force`,
              ),
              expectedPublicCliCommand(
                `auth-method passkey enable --schema ${SCHEMA} --cwd ${app.path}`,
              ),
            ],
            details: {
              question: QUESTION,
              file: SCHEMA_FILE,
              usable: ["password"],
              suggested_args: [
                [
                  "auth-method",
                  "password",
                  "disable",
                  "--schema",
                  SCHEMA,
                  "--cwd",
                  app.path,
                  "--force",
                ],
                ["auth-method", "passkey", "enable", "--schema", SCHEMA, "--cwd", app.path],
              ],
            },
          });
        });

        it("keeps a dry run a dry run in the command it suggests", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");

          const result = await app.disableMethod("password", ["--dry-run"]);

          expect(result).toSuggest(
            `auth-method password disable --schema ${SCHEMA} --cwd ${app.path} --force --dry-run`,
          );
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");

          const result = await app.disableMethod("password");

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");

          const result = await app.disableMethod("password");

          expect(result).toSuggestExactly(
            `auth-method password disable --schema ${SCHEMA} --cwd ${app.path} --force`,
          );
        });

        it("disables nothing", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");
          const files = await app.snapshot();

          await app.disableMethod("password");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("while a login flow still asks for a password", () => {
        it("is refused, naming each step that does", async () => {
          const app = await aSetUpApp();

          const result = await app.disableMethod("password");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:password:disable",
            source: "",
            code: "E_VALIDATION",
            message: `Disabling password in ${SCHEMA_FILE} would break a login flow that still uses it:\n  - ${FLOW_FILE}: step "password" collects password\n    Left with no field or sign-in method. Targeted by identifier.submit, register.user_already_exists.\n  - ${FLOW_FILE}: step "register-password" collects password\n    Left with no field or sign-in method. Targeted by register.submit.`,
            hint: `Edit those steps first; login flows are not edited for you. From each step, remove its x-auth-methods#password field. Delete a step left with no field or sign-in method: retarget the transitions listed for it. ${expectedPublicCliCommand("deploy --dry-run")} checks the edited flow; then run the command again.`,
            details: {
              file: SCHEMA_FILE,
              issues: [
                {
                  path: FLOW_FILE,
                  rule: "schema/fields-resolve",
                  message: 'step "password": "password" is not an enabled authentication method',
                  step: "password",
                },
                {
                  path: FLOW_FILE,
                  rule: "schema/fields-resolve",
                  message:
                    'step "register-password": "password" is not an enabled authentication method',
                  step: "register-password",
                },
              ],
              steps: [
                {
                  path: FLOW_FILE,
                  step: "password",
                  keeps: [],
                  entry_for: [],
                  targeted_by: [
                    { step: "identifier", transition: "submit" },
                    { step: "register", transition: "user_already_exists" },
                    { step: "register-password", transition: "user_already_exists" },
                  ],
                },
                {
                  path: FLOW_FILE,
                  step: "register-password",
                  keeps: [],
                  entry_for: [],
                  targeted_by: [{ step: "register", transition: "submit" }],
                },
              ],
            },
          });
        });

        it("leaves the project as it was", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.disableMethod("password");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("leaves nothing to publish", async () => {
          const app = await aSetUpApp();
          const before = await app.publishData();

          await app.disableMethod("password");

          expect((await app.deployData()).content_hash).toBe(before.content_hash);
        });
      });

      describe("when password is already off", () => {
        it("succeeds, with nothing to disable", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");

          const result = await app.disableMethod("password");

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [],
              usable: ["passkey"],
              not_offered: [],
              notices: [{ severity: "warning", message: NO_ACTIVE_FLOW_WARNING }],
              title: "Nothing to disable for default-human-user",
              next_args: [],
              next_commands: [],
            },
            warnings: [NO_ACTIVE_FLOW_WARNING],
          });
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");
          const files = await app.snapshot();

          await app.disableMethod("password");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("under --dry-run", () => {
        it("previews turning password off, and the command that does", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");

          const result = await app.disableMethod("password", ["--dry-run", "--force"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [SCHEMA_FILE],
              usable: [],
              not_offered: [],
              notices: [{ severity: "warning", message: WOULD_LEAVE_NONE_WARNING }],
              title: "Would disable password for default-human-user (dry run)",
              dry_run: true,
              next_args: [["auth-method", "password", "disable", "--cwd", app.path, "--force"]],
              next_commands: [
                expectedPublicCliCommand(`auth-method password disable --cwd ${app.path} --force`),
              ],
            },
            warnings: [WOULD_LEAVE_NONE_WARNING],
          });
        });

        it("writes nothing", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("password");
          const files = await app.snapshot();

          await app.disableMethod("password", ["--dry-run", "--force"]);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("says there is nothing to disable when password is already off", async () => {
          const app = await aSetUpApp();
          await app.hasTurnedOffByHand("password");

          const result = await app.disableMethod("password", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:password:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "password",
              changed: [],
              usable: ["passkey"],
              not_offered: [],
              notices: [{ severity: "warning", message: NO_ACTIVE_FLOW_WARNING }],
              title: "Nothing to disable for default-human-user (dry run)",
              dry_run: true,
              next_args: [["auth-method", "password", "disable", "--cwd", app.path]],
              next_commands: [
                expectedPublicCliCommand(`auth-method password disable --cwd ${app.path}`),
              ],
            },
            warnings: [NO_ACTIVE_FLOW_WARNING],
          });
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says which flow step still asks for a password", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("password");

        expect(result).toSay('step "password"');
      });

      it("says there was nothing to disable", async () => {
        const app = await aSetUpApp();
        await app.hasTurnedOffByHand("password");

        const result = await app.disableMethodRendered("password");

        expect(result).toPrint("Nothing to disable for default-human-user");
      });

      it("says what it disabled, as the envelope titles it", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("password");

        const result = await app.run([
          "auth-method",
          "password",
          "disable",
          "--non-interactive",
          "--force",
        ]);

        expect(result.stdout.split("\n")).toContain("Disabled password for default-human-user");
      });

      it("suggests deploying the change", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("password");

        const result = await app.run([
          "auth-method",
          "password",
          "disable",
          "--non-interactive",
          "--force",
        ]);

        expect(result).toPrint(`deploy --dry-run --cwd ${app.path}`);
      });

      it("warns once when it left no way to sign in", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("password");

        const result = await app.run([
          "auth-method",
          "password",
          "disable",
          "--non-interactive",
          "--force",
        ]);

        expect(result).toSayOnce(LEFT_WITH_NONE_WARNING);
      });

      it("says what it would disable on a dry run, as the envelope titles it", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("password");

        const result = await app.run([
          "auth-method",
          "password",
          "disable",
          "--non-interactive",
          "--dry-run",
          "--force",
        ]);

        expect(result.stdout.split("\n")).toContain(
          "Would disable password for default-human-user (dry run)",
        );
      });

      it("prints the question and the commands that go on when it needs --force", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("password");

        const result = await app.disableMethodRendered("password");

        expect(result).toSay(
          `${QUESTION} Re-run with --force only once they agree.\n\nNext:\n  $ ${expectedPublicCliCommand(`auth-method password disable --schema ${SCHEMA} --cwd ${app.path} --force`)}\n  $ ${expectedPublicCliCommand(`auth-method passkey enable --schema ${SCHEMA} --cwd ${app.path}`)}`,
        );
      });

      it("spells out the escape sequence in a schema name it refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "auth-method",
          "password",
          "disable",
          "--non-interactive",
          "--schema",
          HOSTILE_SCHEMA,
        ]);

        expect(result).toSay("named no\\x1b[31mpe");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();
        await app.hasTurnedOffByHand("password");

        const result = await app.disableMethodRendered("password");

        expect(result).toPrintNoJson();
      });
    });
  });
});
