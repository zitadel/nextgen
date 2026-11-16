import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, MOCK_SERVER_URL } from "@tests/helpers/project";
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
 * The login flow that starts with a passkey on the passkey-first preset.
 */
const FLOW_FILE = ".zitadel/flows/default-login.json";

/**
 * A schema name no project holds, with an escape sequence in it.
 */
const HOSTILE_SCHEMA = "no\u001b[31mpe";

/**
 * What the command asks before it removes the last way to sign in.
 */
const QUESTION = "Disable passkey anyway? Nobody will be able to sign in to default-human-user.";

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

describe("auth-method passkey disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns passkey off, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.disableMethod("passkey");

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still turns passkey off, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.disableMethod("passkey");

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["auth-method", "passkey", "disable", "--force"];

      await app.inEveryRendering((how) => {
        return app.run(how.json ? [...args, "--json"] : args, how.env);
      });
    });

    describe("--json", () => {
      it("turns passkey off", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethod("passkey");

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:passkey:disable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "passkey",
            changed: [SCHEMA_FILE],
            usable: ["password"],
            not_offered: [],
            notices: [],
            title: "Disabled passkey for default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--server", MOCK_SERVER_URL, "--cwd", app.path],
              [
                "deploy",
                "--message",
                "<what changed>",
                "--server",
                MOCK_SERVER_URL,
                "--cwd",
                app.path,
              ],
            ],
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("turns passkey off when it was the last way to sign in and --force was given", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("passkey");

        const result = await app.disableMethod("passkey", ["--force"]);

        expect(JSON.parse(result.stdout)).toEqual({
          cli_version: cliVersion.version,
          command: "auth-method:passkey:disable",
          source: "",
          status: "ok",
          data: {
            schema: SCHEMA,
            file: SCHEMA_FILE,
            method: "passkey",
            changed: [SCHEMA_FILE],
            usable: [],
            not_offered: [],
            notices: [{ severity: "warning", message: LEFT_WITH_NONE_WARNING }],
            title: "Disabled passkey for default-human-user",
            next_args: [
              ["deploy", "--dry-run", "--server", MOCK_SERVER_URL, "--cwd", app.path],
              [
                "deploy",
                "--message",
                "<what changed>",
                "--server",
                MOCK_SERVER_URL,
                "--cwd",
                app.path,
              ],
            ],
            next_commands: [
              expectedPublicCliCommand(
                `deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [LEFT_WITH_NONE_WARNING],
        });
      });

      it("leaves the change for deploy to publish", async () => {
        const app = await aSetUpApp();

        await app.disableMethod("passkey");

        expect(await app.publishedAuthMethods()).toHaveProperty("passkey", { enabled: true });
      });

      it("refuses a schema the project does not hold, with its name as typed", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethod("passkey", ["--schema", HOSTILE_SCHEMA]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "auth-method:passkey:disable",
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

      describe("on a project whose login starts with a passkey", () => {
        it("is refused, naming each step that offers one", async () => {
          const app = await aSetUpApp(["--preset", "passkey-first"]);

          const result = await app.disableMethod("passkey");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:passkey:disable",
            source: "",
            code: "E_VALIDATION",
            message: `Disabling passkey in ${SCHEMA_FILE} would break a login flow that still uses it:\n  - ${FLOW_FILE}: step "passkey-first" offers passkey (action "passkey")\n    Left with no field or sign-in method. Entry step of purposes.login. Targeted by register.sign_in (via purposes.login).\n  - ${FLOW_FILE}: step "identifier" offers passkey (action "passkey")\n    Still has field "email".\n  - ${FLOW_FILE}: step "password" offers passkey (action "passkey")\n    Still has field "x-auth-methods#password".\n  - ${FLOW_FILE}: step "register" offers passkey (action "passkey_register")\n    Still has field "email".`,
            hint: `Edit those steps first; login flows are not edited for you. From each step, remove its passkey actions and their transitions. Delete a step left with no field or sign-in method: retarget the transitions listed for it (one marked via purposes.<key> follows that key instead), and point the purposes key it is the entry step of at another step. ${expectedPublicCliCommand("deploy --dry-run")} checks the edited flow; then run the command again.`,
            details: {
              file: SCHEMA_FILE,
              issues: [
                {
                  path: FLOW_FILE,
                  rule: "schema/passkey-actions",
                  message:
                    'step "passkey-first": action "passkey" offers passkey but "passkey" is not an enabled authentication method',
                  step: "passkey-first",
                },
                {
                  path: FLOW_FILE,
                  rule: "schema/passkey-actions",
                  message:
                    'step "identifier": action "passkey" offers passkey but "passkey" is not an enabled authentication method',
                  step: "identifier",
                },
                {
                  path: FLOW_FILE,
                  rule: "schema/passkey-actions",
                  message:
                    'step "password": action "passkey" offers passkey but "passkey" is not an enabled authentication method',
                  step: "password",
                },
                {
                  path: FLOW_FILE,
                  rule: "schema/passkey-actions",
                  message:
                    'step "register": action "passkey_register" offers passkey but "passkey" is not an enabled authentication method',
                  step: "register",
                },
              ],
              steps: [
                {
                  path: FLOW_FILE,
                  step: "passkey-first",
                  keeps: [],
                  entry_for: ["login"],
                  targeted_by: [{ step: "register", transition: "sign_in", purpose: "login" }],
                },
                {
                  path: FLOW_FILE,
                  step: "identifier",
                  keeps: ['field "email"'],
                  entry_for: [],
                  targeted_by: [{ step: "passkey-first", transition: "email_fallback" }],
                },
                {
                  path: FLOW_FILE,
                  step: "password",
                  keeps: ['field "x-auth-methods#password"'],
                  entry_for: [],
                  targeted_by: [
                    { step: "identifier", transition: "submit" },
                    { step: "register", transition: "user_already_exists" },
                    { step: "register-password", transition: "user_already_exists" },
                  ],
                },
                {
                  path: FLOW_FILE,
                  step: "register",
                  keeps: ['field "email"'],
                  entry_for: ["register"],
                  targeted_by: [
                    { step: "passkey-first", transition: "register", purpose: "register" },
                    { step: "identifier", transition: "register", purpose: "register" },
                    { step: "identifier", transition: "user_not_found" },
                  ],
                },
              ],
            },
          });
        });

        it("leaves the project as it was", async () => {
          const app = await aSetUpApp(["--preset", "passkey-first"]);
          const files = await app.snapshot();

          await app.disableMethod("passkey");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("leaves nothing to publish", async () => {
          const app = await aSetUpApp(["--preset", "passkey-first"]);
          const before = await app.publishData();

          await app.disableMethod("passkey");

          expect((await app.deployData()).content_hash).toBe(before.content_hash);
        });
      });

      describe("removing the last way to sign in without --force when no one can be asked", () => {
        it("is refused, with the question and the commands that go on", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey");

          expect(JSON.parse(result.stdout)).toEqual({
            status: "error",
            cli_version: cliVersion.version,
            command: "auth-method:passkey:disable",
            source: "",
            code: "E_CONFIRMATION_REQUIRED",
            message: `${SCHEMA_FILE} would have no way to sign in left`,
            hint: `Enable another method first, such as ${expectedPublicCliCommand("auth-method sso enable --provider '<name>'")}. If the schema's users are only managed through the API, ask a person first: ${QUESTION} Re-run with --force only once they agree (the first of details.suggested_args holds the exact arguments).`,
            next_commands: [
              expectedPublicCliCommand(
                `auth-method passkey disable --schema ${SCHEMA} --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `auth-method password enable --schema ${SCHEMA} --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
              ),
            ],
            details: {
              question: QUESTION,
              file: SCHEMA_FILE,
              usable: ["passkey"],
              suggested_args: [
                [
                  "auth-method",
                  "passkey",
                  "disable",
                  "--schema",
                  SCHEMA,
                  "--force",
                  "--server",
                  MOCK_SERVER_URL,
                  "--cwd",
                  app.path,
                ],
                [
                  "auth-method",
                  "password",
                  "enable",
                  "--schema",
                  SCHEMA,
                  "--server",
                  MOCK_SERVER_URL,
                  "--cwd",
                  app.path,
                ],
              ],
            },
          });
        });

        it("keeps a dry run a dry run in the command it suggests", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey", ["--dry-run"]);

          expect(result).toSuggest(
            `auth-method passkey disable --schema ${SCHEMA} --force --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          );
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey");

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey");

          expect(result).toSuggestExactly(
            `auth-method passkey disable --schema ${SCHEMA} --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
          );
        });

        it("disables nothing", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");
          const files = await app.snapshot();

          await app.disableMethod("passkey");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("when passkey is already off", () => {
        it("succeeds, with nothing to disable", async () => {
          const app = await aSetUpApp();
          await app.hasDisabledMethod("passkey");

          const result = await app.disableMethod("passkey");

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [],
              usable: ["password"],
              not_offered: [],
              notices: [],
              title: "Nothing to disable for default-human-user",
              next_args: [],
              next_commands: [],
            },
            warnings: [],
          });
        });

        it("changes nothing", async () => {
          const app = await aSetUpApp();
          await app.hasDisabledMethod("passkey");
          const files = await app.snapshot();

          await app.disableMethod("passkey");

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });
      });

      describe("under --dry-run", () => {
        it("previews turning passkey off, and the command that does", async () => {
          const app = await aSetUpApp();
          await app.signsInOnlyWith("passkey");

          const result = await app.disableMethod("passkey", ["--dry-run", "--force"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [SCHEMA_FILE],
              usable: [],
              not_offered: [],
              notices: [{ severity: "warning", message: WOULD_LEAVE_NONE_WARNING }],
              title: "Would disable passkey for default-human-user (dry run)",
              dry_run: true,
              next_args: [
                [
                  "auth-method",
                  "passkey",
                  "disable",
                  "--force",
                  "--server",
                  MOCK_SERVER_URL,
                  "--cwd",
                  app.path,
                ],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method passkey disable --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [WOULD_LEAVE_NONE_WARNING],
          });
        });

        it("previews turning passkey off without asking for --force when another way remains", async () => {
          const app = await aSetUpApp();

          const result = await app.disableMethod("passkey", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [SCHEMA_FILE],
              usable: ["password"],
              not_offered: [],
              notices: [],
              title: "Would disable passkey for default-human-user (dry run)",
              dry_run: true,
              next_args: [
                [
                  "auth-method",
                  "passkey",
                  "disable",
                  "--server",
                  MOCK_SERVER_URL,
                  "--cwd",
                  app.path,
                ],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method passkey disable --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });

        it("writes nothing", async () => {
          const app = await aSetUpApp();
          const files = await app.snapshot();

          await app.disableMethod("passkey", ["--dry-run"]);

          expect(await files.changes()).toMatchObject(NO_CHANGES);
        });

        it("says there is nothing to disable when passkey is already off", async () => {
          const app = await aSetUpApp();
          await app.hasDisabledMethod("passkey");

          const result = await app.disableMethod("passkey", ["--dry-run"]);

          expect(JSON.parse(result.stdout)).toEqual({
            cli_version: cliVersion.version,
            command: "auth-method:passkey:disable",
            source: "",
            status: "ok",
            data: {
              schema: SCHEMA,
              file: SCHEMA_FILE,
              method: "passkey",
              changed: [],
              usable: ["password"],
              not_offered: [],
              notices: [],
              title: "Nothing to disable for default-human-user (dry run)",
              dry_run: true,
              next_args: [
                [
                  "auth-method",
                  "passkey",
                  "disable",
                  "--server",
                  MOCK_SERVER_URL,
                  "--cwd",
                  app.path,
                ],
              ],
              next_commands: [
                expectedPublicCliCommand(
                  `auth-method passkey disable --server ${MOCK_SERVER_URL} --cwd ${app.path}`,
                ),
              ],
            },
            warnings: [],
          });
        });
      });

      describe("once deployed", () => {
        it("publishes passkey as off", async () => {
          const app = await aSetUpApp();

          await app.disableMethod("passkey");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("passkey", { enabled: false });
        });

        it("keeps password on", async () => {
          const app = await aSetUpApp();

          await app.disableMethod("passkey");

          expect(await app.authMethodsOnceDeployed()).toHaveProperty("password", { enabled: true });
        });

        it("leaves nothing left to deploy", async () => {
          const app = await aSetUpApp();

          await app.disableMethod("passkey");

          const [first, again] = await app.releasesOfTwoDeploys();
          expect(again).toBe(first);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says there was nothing to disable", async () => {
        const app = await aSetUpApp();
        await app.hasDisabledMethod("passkey");

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrint("Nothing to disable for default-human-user");
      });

      it("says what it disabled, as the envelope titles it", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result.stdout.split("\n")).toContain("Disabled passkey for default-human-user");
      });

      it("suggests deploying the change", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrint(`deploy --dry-run --server ${MOCK_SERVER_URL} --cwd ${app.path}`);
      });

      it("warns once when it left no way to sign in", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("passkey");

        const result = await app.run([
          "auth-method",
          "passkey",
          "disable",
          "--non-interactive",
          "--force",
        ]);

        expect(result).toSayOnce(LEFT_WITH_NONE_WARNING);
      });

      it("says what it would disable on a dry run, as the envelope titles it", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "auth-method",
          "passkey",
          "disable",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result.stdout.split("\n")).toContain(
          "Would disable passkey for default-human-user (dry run)",
        );
      });

      it("prints the question and the commands that go on when it needs --force", async () => {
        const app = await aSetUpApp();
        await app.signsInOnlyWith("passkey");

        const result = await app.disableMethodRendered("passkey");

        expect(result).toSay(
          `${QUESTION} Re-run with --force only once they agree.\n\nNext:\n  $ ${expectedPublicCliCommand(`auth-method passkey disable --schema ${SCHEMA} --force --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}\n  $ ${expectedPublicCliCommand(`auth-method password enable --schema ${SCHEMA} --server ${MOCK_SERVER_URL} --cwd ${app.path}`)}`,
        );
      });

      it("spells out the escape sequence in a schema name it refuses", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "auth-method",
          "passkey",
          "disable",
          "--non-interactive",
          "--schema",
          HOSTILE_SCHEMA,
        ]);

        expect(result).toSay("named no\\x1b[31mpe");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrintNoJson();
      });
    });
  });
});
