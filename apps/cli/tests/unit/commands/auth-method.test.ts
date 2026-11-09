import { chmod } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { COMMANDS } from "@/index";
import {
  aPasswordFlow,
  aProject,
  aSchema,
  authMethodJson,
  authMethodText,
  DEFAULT_SCHEMA,
  DONE_STEP,
  IDENTIFIER_STEP,
  LOGIN_FLOW_FILE,
  PASSWORD_STEP,
  SCHEMA_FILE,
  SUBMIT_ACTION,
  writeProject,
} from "@tests/helpers/auth-method";
import { authMethods, type ConfigDocuments } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { readJson } from "@tests/helpers/local-project";
import {
  expectedPublicCliCommand,
  parseJson,
  runCliForTest,
  stripAnsi,
} from "@tests/helpers/run-cli";

/**
 * A schema with both password and passkey enabled.
 */
const BOTH = authMethods("password", "passkey");

/**
 * A schema whose only enabled method is password.
 */
const PASSWORD_ONLY = { password: { enabled: true }, passkey: { enabled: false } };

/**
 * A schema whose only enabled method is passkey.
 */
const PASSKEY_ONLY = { password: { enabled: false }, passkey: { enabled: true } };

/**
 * Where a schema records whether passkey is enabled.
 */
const PASSKEY_ENTRY = ["x-auth-methods", "passkey"];

/**
 * The action that signs in with a passkey.
 */
const PASSKEY_ACTION = { name: "passkey", kind: "passkey", primary: true };

/**
 * A login flow whose only way in is a passkey on the identifier step.
 */
const PASSKEY_FLOW = {
  ...aPasswordFlow(),
  steps: [
    { ...IDENTIFIER_STEP, actions: [PASSKEY_ACTION], transitions: { passkey: { target: "done" } } },
    DONE_STEP,
  ],
};

/**
 * A login flow that collects the email and finishes, offering no method.
 */
const NO_METHOD_FLOW = {
  ...aPasswordFlow(),
  steps: [{ ...IDENTIFIER_STEP, transitions: { submit: { target: "done" } } }, DONE_STEP],
};

/**
 * A login flow whose register purpose names a step that does not exist, so it
 * cannot be checked.
 */
const BROKEN_FLOW = { ...aPasswordFlow(), purposes: { login: "identifier", register: "missing" } };

/**
 * The warning for enabling passkey on the default Project, whose flow offers only a password.
 */
const PASSKEY_NOT_OFFERED =
  "No login flow for default-human-user offers passkey yet. " +
  'In .zitadel/flows/default-human-user-login.json, add a "kind": "passkey" action to a step reached from purposes.login, ' +
  'plus a transition under the action\'s name. A "kind": "passkey_register" action does the same for sign-up. ' +
  "See .zitadel/flows/README.md.";

/**
 * The warning for enabling password on a Project whose flow offers only a passkey.
 */
const PASSWORD_NOT_OFFERED =
  "No login flow for default-human-user offers password yet. " +
  'In .zitadel/flows/default-human-user-login.json, add "x-auth-methods#password" ' +
  'to the fields of a step reached from purposes.login, with a "kind": "submit" action ' +
  "and a transition under its name. See .zitadel/flows/README.md.";

/**
 * The warning for a schema no active flow lets anyone sign in to.
 */
const NOBODY_CAN_SIGN_IN =
  "No active login flow for default-human-user offers a method it enables, " +
  "so nobody can sign in until one does.";

/**
 * The warning for a schema left with no way to sign in.
 */
const LEFT_WITHOUT_SIGN_IN =
  "default-human-user is left with no way to sign in. Its users can only be managed through the API.";

/**
 * The warning a dry run gives for a schema that would be left with no way to sign in.
 */
const WOULD_BE_LEFT_WITHOUT_SIGN_IN =
  "default-human-user would be left with no way to sign in. Its users can only be managed through the API.";

/**
 * The refusal to remove the last way to sign in to the default schema, which a
 * dry run gives as the real run does.
 */
const LAST_WAY_REFUSAL = {
  code: "E_CONFIRMATION_REQUIRED",
  message: ".zitadel/schemas/default-human-user.json would have no way to sign in left",
  hint:
    "Enable another method first, such as `zitadel auth-method sso enable --provider <name>`. " +
    "If the schema's users are only managed through the API, ask a person first: Disable passkey anyway? " +
    "Nobody will be able to sign in to default-human-user. " +
    "Re-run with --force only once they agree (the first of details.suggested_args holds the exact arguments).",
};

/**
 * Root ignores file modes, so a read-only file is still written when the tests
 * run as root.
 */
const RUNS_AS_ROOT = process.getuid?.() === 0;

/**
 * The ids, such as `auth-method:password:enable`, of the commands a run
 * suggests: the refusal's at the top of the envelope, the change's under `data`.
 *
 * @param envelope - The parsed `--json` envelope.
 * @returns The command ids, in the order the commands are suggested.
 */
function suggestedCommandIds(envelope: unknown): string[] {
  const commands = [...nextCommandsOf(envelope)];
  if (typeof envelope === "object" && envelope !== null && "data" in envelope) {
    commands.push(...nextCommandsOf(envelope.data));
  }
  return commands.map((command) => {
    const words = command.replace(/^npx \S+ /, "").split(" ");
    const firstFlag = words.findIndex((word) => {
      return word.startsWith("-");
    });
    if (firstFlag === -1) {
      return words.join(":");
    }
    return words.slice(0, firstFlag).join(":");
  });
}

/**
 * The `next_commands` of one level of an envelope.
 *
 * @param level - The envelope or its `data`.
 * @returns The commands, or none when the level lists none.
 */
function nextCommandsOf(level: unknown): string[] {
  if (typeof level !== "object" || level === null || !("next_commands" in level)) {
    return [];
  }
  if (!Array.isArray(level.next_commands)) {
    return [];
  }
  return level.next_commands.filter((command) => {
    return typeof command === "string";
  });
}

describe("auth-method password and passkey", () => {
  describe("when it changes a schema", () => {
    it("reports the schema, the method, whether it changed and what is left", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          schema: DEFAULT_SCHEMA,
          file: SCHEMA_FILE,
          method: "passkey",
          changed: [SCHEMA_FILE],
          usable: ["password"],
          not_offered: [],
        },
      });
    });

    it("lists a dry run and a deploy as the next commands", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          next_commands: [
            expectedPublicCliCommand(`deploy --dry-run --cwd ${dir}`),
            expectedPublicCliCommand(`deploy -m '<what changed>' --cwd ${dir}`),
          ],
        },
      });
    });

    it("hands over the follow-ups as argument lists when the path needs quoting", async ({
      dir,
    }) => {
      const cwd = join(dir, "my project");
      await writeProject(cwd, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(cwd, "passkey", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          next_commands: [],
          next_args: [
            ["deploy", "--dry-run", "--cwd", cwd],
            ["deploy", "-m", "<what changed>", "--cwd", cwd],
          ],
        },
      });
    });

    it("works with a local server that is not running", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(
        authMethodJson(dir, "passkey", "disable", "--server", "local"),
      );

      expect(result.exitCode).toBe(0);
    });

    it("lists no next commands when nothing changed", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "password", "enable"));

      expect(parseJson(result.stdout)).toMatchObject({
        data: { changed: [], next_commands: [], next_args: [] },
      });
    });
  });

  describe("when no flow offers the method", () => {
    it.for([
      { method: "passkey", methods: PASSWORD_ONLY, flow: aPasswordFlow(), flags: [] },
      { method: "password", methods: PASSKEY_ONLY, flow: PASSKEY_FLOW, flags: ["--dry-run"] },
    ])("lists $method as not offered", async ({ method, methods, flow, flags }, { dir }) => {
      await writeProject(dir, aProject(methods, flow));

      const result = await runCliForTest(authMethodJson(dir, method, "enable", ...flags));

      expect(parseJson(result.stdout)).toMatchObject({ data: { not_offered: [method] } });
    });

    it.for([
      {
        method: "passkey",
        methods: PASSWORD_ONLY,
        flow: aPasswordFlow(),
        flags: [],
        warning: PASSKEY_NOT_OFFERED,
      },
      {
        method: "password",
        methods: PASSKEY_ONLY,
        flow: PASSKEY_FLOW,
        flags: ["--dry-run"],
        warning: PASSWORD_NOT_OFFERED,
      },
    ])(
      "says what a flow needs to offer $method",
      async ({ method, methods, flow, flags, warning }, { dir }) => {
        await writeProject(dir, aProject(methods, flow));

        const result = await runCliForTest(authMethodJson(dir, method, "enable", ...flags));

        expect(parseJson(result.stdout)).toMatchObject({ warnings: [warning] });
      },
    );

    it("does not count a register step that only enrols a passkey", async ({ dir }) => {
      const enrolling = {
        ...aPasswordFlow(),
        purposes: { login: "identifier", register: "register" },
        steps: [
          {
            ...IDENTIFIER_STEP,
            transitions: { ...IDENTIFIER_STEP.transitions, user_not_found: { target: "register" } },
          },
          PASSWORD_STEP,
          DONE_STEP,
          {
            name: "register",
            fields: ["email"],
            actions: [{ name: "passkey_register", kind: "passkey_register", primary: true }],
            transitions: {
              passkey_register: { target: "done" },
              user_already_exists: { target: "identifier" },
            },
          },
        ],
      };
      await writeProject(dir, aProject(PASSWORD_ONLY, enrolling));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "enable"));

      expect(parseJson(result.stdout)).toMatchObject({ data: { not_offered: ["passkey"] } });
    });

    describe("with a draft flow that offers it", () => {
      const draft = {
        ...aPasswordFlow(),
        name: "draft-login",
        status: "draft",
        purposes: { login: "passkey-first" },
        steps: [
          {
            name: "passkey-first",
            fields: [],
            actions: [PASSKEY_ACTION],
            transitions: { passkey: { target: "done" } },
          },
          DONE_STEP,
        ],
      };
      const documents: ConfigDocuments = {
        schemas: { "default-human-user.json": aSchema(BOTH) },
        flows: { "default-human-user-login.json": aPasswordFlow(), "draft-login.json": draft },
      };

      it("does not count the draft flow as offering the method", async ({ dir }) => {
        await writeProject(dir, documents);

        const result = await runCliForTest(authMethodJson(dir, "passkey", "enable"));

        expect(parseJson(result.stdout)).toMatchObject({ data: { not_offered: ["passkey"] } });
      });

      it("names only the active flow as the place to add it", async ({ dir }) => {
        await writeProject(dir, documents);

        const result = await runCliForTest(authMethodJson(dir, "passkey", "enable"));

        expect(parseJson(result.stdout)).toMatchObject({ warnings: [PASSKEY_NOT_OFFERED] });
      });
    });

    it("warns when no active flow offers any method the schema enables", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, NO_METHOD_FLOW));

      const result = await runCliForTest(authMethodJson(dir, "password", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({ warnings: [NOBODY_CAN_SIGN_IN] });
    });

    it("does not name a flow without a login entry", async ({ dir }) => {
      await writeProject(dir, {
        schemas: { "default-human-user.json": aSchema(PASSWORD_ONLY) },
        flows: {
          "default-human-user-login.json": aPasswordFlow(),
          "signup.json": {
            ...aPasswordFlow(),
            name: "signup",
            purposes: { register: "identifier" },
          },
        },
      });

      const result = await runCliForTest(authMethodJson(dir, "passkey", "enable", "--dry-run"));

      expect(parseJson(result.stdout)).toMatchObject({ warnings: [PASSKEY_NOT_OFFERED] });
    });

    it("points at the flows folder when no flow is active", async ({ dir }) => {
      await writeProject(dir, aProject(PASSWORD_ONLY, { ...aPasswordFlow(), status: "draft" }));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "enable", "--dry-run"));

      expect(parseJson(result.stdout)).toMatchObject({
        warnings: [
          "No login flow for default-human-user offers passkey yet. " +
            "In an active login flow for default-human-user in .zitadel/flows/, " +
            'add a "kind": "passkey" action to a step reached from purposes.login, ' +
            'plus a transition under the action\'s name. A "kind": "passkey_register" action does the same for sign-up. ' +
            "See .zitadel/flows/README.md.",
          NOBODY_CAN_SIGN_IN,
        ],
      });
    });
  });

  describe("with --schema", () => {
    const twoSchemas: ConfigDocuments = {
      schemas: {
        "customers.json": aSchema(BOTH, "customers"),
        "staff.json": aSchema(BOTH, "staff"),
      },
      flows: {
        "customers-login.json": aPasswordFlow("customers"),
        "staff-login.json": aPasswordFlow("staff"),
      },
    };

    it("changes the named schema", async ({ dir }) => {
      await writeProject(dir, twoSchemas);

      await runCliForTest(authMethodJson(dir, "passkey", "disable", "--schema", "staff"));

      expect(await readJson(dir, ".zitadel/schemas/staff.json")).toHaveProperty(PASSKEY_ENTRY, {
        enabled: false,
      });
    });

    it("leaves the other schemas alone", async ({ dir }) => {
      await writeProject(dir, twoSchemas);

      await runCliForTest(authMethodJson(dir, "passkey", "disable", "--schema", "staff"));

      expect(await readJson(dir, ".zitadel/schemas/customers.json")).toHaveProperty(PASSKEY_ENTRY, {
        enabled: true,
      });
    });

    it("is required when the Project has more than one schema", async ({ dir }) => {
      await writeProject(dir, { schemas: twoSchemas.schemas });

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        status: "error",
        code: "E_VALIDATION",
        hint: expect.stringContaining("Name the one to change with --schema"),
      });
    });
  });

  describe("when it refuses", () => {
    it("refuses a schema that points at an external url", async ({ dir }) => {
      const url = "https://schemas.test.invalid/customers.json";
      await writeProject(dir, {
        schemas: { "default-human-user.json": { kind: "schema-url", url } },
      });

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({ code: "E_VALIDATION", details: { url } });
    });

    it("refuses a schema its contract refuses, naming the file", async ({ dir }) => {
      await writeProject(dir, aProject([]));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "enable"));

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        details: { problems: [expect.objectContaining({ path: SCHEMA_FILE })] },
      });
    });

    it("says to fix the file it names before running again", async ({ dir }) => {
      await writeProject(dir, aProject([]));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "enable"));

      expect(parseJson(result.stdout)).toMatchObject({
        hint: "Fix the files named above, then run the command again; nothing was changed.",
      });
    });

    it("refuses password on a schema with no x-identifier", async ({ dir }) => {
      const { "x-identifier": _, ...noIdentifier } = aSchema(PASSKEY_ONLY);
      await writeProject(dir, { schemas: { "default-human-user.json": noIdentifier } });

      const result = await runCliForTest(authMethodJson(dir, "password", "enable"));

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        details: { method: "password" },
      });
    });

    describe("when a flow still uses the method", () => {
      it("names the rule and step a disabled method would break", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, aPasswordFlow()));

        const result = await runCliForTest(authMethodJson(dir, "password", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          code: "E_VALIDATION",
          details: {
            issues: [expect.objectContaining({ rule: "schema/fields-resolve", step: "password" })],
          },
        });
      });

      it("says which step uses the method and what it keeps without it", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, aPasswordFlow()));

        const result = await runCliForTest(authMethodJson(dir, "password", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          message:
            "Disabling password in .zitadel/schemas/default-human-user.json would break a login flow that still uses it:\n" +
            '  - .zitadel/flows/default-human-user-login.json: step "password" collects password\n' +
            "    Left with no field or sign-in method. Targeted by identifier.submit.",
        });
      });

      it("says only the edits the steps need", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, aPasswordFlow()));

        const result = await runCliForTest(authMethodJson(dir, "password", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          hint:
            "Edit those steps first; login flows are not edited for you. From each step, remove its x-auth-methods#password field. " +
            "Delete a step left with no field or sign-in method: retarget the transitions listed for it. " +
            "`zitadel deploy --dry-run` checks the edited flow; then run the command again.",
        });
      });

      it("lists each step with what it keeps and what leads to it", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, aPasswordFlow()));

        const result = await runCliForTest(authMethodJson(dir, "password", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          details: {
            steps: [
              {
                path: LOGIN_FLOW_FILE,
                step: "password",
                keeps: [],
                entry_for: [],
                targeted_by: [{ step: "identifier", transition: "submit" }],
              },
            ],
          },
        });
      });

      it("refuses under --dry-run too", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, aPasswordFlow()));

        const result = await runCliForTest(authMethodJson(dir, "password", "disable", "--dry-run"));

        expect(parseJson(result.stdout)).toMatchObject({
          details: {
            issues: [expect.objectContaining({ rule: "schema/fields-resolve", step: "password" })],
          },
        });
      });

      it("writes nothing when it refuses", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, aPasswordFlow()));

        await runCliForTest(authMethodJson(dir, "password", "disable"));

        expect(await readJson(dir, SCHEMA_FILE)).toEqual(aSchema(BOTH));
      });
    });

    describe("when disabling passkey would empty an entry step", () => {
      const passkeyFirst = {
        ...aPasswordFlow(),
        purposes: { login: "passkey-first" },
        steps: [
          {
            name: "passkey-first",
            actions: [PASSKEY_ACTION, { name: "email_fallback", kind: "navigate" }],
            transitions: { passkey: { target: "done" }, email_fallback: { target: "identifier" } },
          },
          {
            ...IDENTIFIER_STEP,
            actions: [SUBMIT_ACTION, { name: "passkey", kind: "passkey" }],
            transitions: { ...IDENTIFIER_STEP.transitions, passkey: { target: "done" } },
          },
          PASSWORD_STEP,
          DONE_STEP,
        ],
      };

      it("names the purpose whose entry step it empties, and not what leads from it", async ({
        dir,
      }) => {
        await writeProject(dir, aProject(BOTH, passkeyFirst));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          message:
            "Disabling passkey in .zitadel/schemas/default-human-user.json would break a login flow that still uses it:\n" +
            '  - .zitadel/flows/default-human-user-login.json: step "passkey-first" offers passkey (action "passkey")\n' +
            "    Left with no field or sign-in method. Entry step of purposes.login.\n" +
            '  - .zitadel/flows/default-human-user-login.json: step "identifier" offers passkey (action "passkey")\n' +
            '    Still has field "email".',
        });
      });

      it("says to point the purpose at another step", async ({ dir }) => {
        await writeProject(dir, aProject(BOTH, passkeyFirst));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          hint:
            "Edit those steps first; login flows are not edited for you. From each step, remove its passkey actions and their transitions. " +
            "Delete a step left with no field or sign-in method: point the purposes key it is the entry step of at another step. " +
            "`zitadel deploy --dry-run` checks the edited flow; then run the command again.",
        });
      });
    });

    it.for([
      { verb: "enable", method: "passkey", methods: PASSWORD_ONLY },
      { verb: "disable", method: "password", methods: BOTH },
    ])(
      "refuses to $verb while a flow has errors that prevent checking it",
      async ({ verb, method, methods }, { dir }) => {
        await writeProject(dir, aProject(methods, BROKEN_FLOW));

        const result = await runCliForTest(authMethodJson(dir, method, verb));

        expect(parseJson(result.stdout)).toMatchObject({
          code: "E_VALIDATION",
          details: { issues: [expect.objectContaining({ rule: "definition" })] },
        });
      },
    );

    it("refuses to disable while a flow file does not match the flow schema", async ({ dir }) => {
      const malformed = {
        ...aPasswordFlow(),
        steps: [
          IDENTIFIER_STEP,
          { ...PASSWORD_STEP, fields: "x-auth-methods#password" },
          DONE_STEP,
        ],
      };
      await writeProject(dir, aProject(BOTH, malformed));

      const result = await runCliForTest(authMethodJson(dir, "password", "disable"));

      expect(parseJson(result.stdout)).toMatchObject({
        code: "E_VALIDATION",
        details: { problems: [expect.objectContaining({ path: LOGIN_FLOW_FILE })] },
      });
    });

    describe("when it would remove the last way to sign in", () => {
      it("refuses, naming the method left", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          code: "E_CONFIRMATION_REQUIRED",
          details: { usable: ["passkey"] },
        });
      });

      it("suggests the --force re-run and enabling password", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          next_commands: [
            expectedPublicCliCommand(
              `auth-method passkey disable --schema default-human-user --cwd ${dir} --force`,
            ),
            expectedPublicCliCommand(
              `auth-method password enable --schema default-human-user --cwd ${dir}`,
            ),
          ],
        });
      });

      it("does not suggest password on a schema with no x-identifier", async ({ dir }) => {
        const { "x-identifier": _, ...noIdentifier } = aSchema(PASSKEY_ONLY);
        await writeProject(dir, { schemas: { "default-human-user.json": noIdentifier } });

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          next_commands: [
            expectedPublicCliCommand(
              `auth-method passkey disable --schema default-human-user --cwd ${dir} --force`,
            ),
          ],
        });
      });

      it.for(["my users&calc", "--force"])(
        "leaves the schema name %s out of runnable commands",
        async (name, { dir }) => {
          await writeProject(dir, { schemas: { [`${name}.json`]: aSchema(PASSKEY_ONLY, name) } });

          const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

          expect(parseJson(result.stdout)).toMatchObject({ next_commands: [] });
        },
      );

      it("hands over the re-runs as argument lists for a schema name that needs quoting", async ({
        dir,
      }) => {
        const name = "my users&calc";
        await writeProject(dir, { schemas: { [`${name}.json`]: aSchema(PASSKEY_ONLY, name) } });

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          details: {
            suggested_args: [
              ["auth-method", "passkey", "disable", "--schema", name, "--cwd", dir, "--force"],
              ["auth-method", "password", "enable", "--schema", name, "--cwd", dir],
            ],
          },
        });
      });

      it("joins a schema name that starts with a dash to its option", async ({ dir }) => {
        await writeProject(dir, { schemas: { "--force.json": aSchema(PASSKEY_ONLY, "--force") } });

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toHaveProperty(
          ["details", "suggested_args", 0],
          ["auth-method", "passkey", "disable", "--schema=--force", "--cwd", dir, "--force"],
        );
      });

      it("does not count otp as a way to sign in", async ({ dir }) => {
        await writeProject(dir, aProject({ passkey: { enabled: true }, otp: { enabled: true } }));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          message: ".zitadel/schemas/default-human-user.json would have no way to sign in left",
        });
      });

      it("points at the arguments of the --force re-run", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

        expect(parseJson(result.stdout)).toMatchObject({
          hint: expect.stringContaining("details.suggested_args"),
        });
      });

      it("exits 3 in its text output", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodText(dir, "passkey", "disable"));

        expect(result.exitCode).toBe(3);
      });

      it("tells a person to re-run with --force only once they agree", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodText(dir, "passkey", "disable"));

        expect(result.stdout + result.stderr).toContain(
          "Re-run with --force only once they agree.",
        );
      });

      it("leaves details.suggested_args out of the human hint", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodText(dir, "passkey", "disable"));

        expect(result.stdout + result.stderr).not.toContain("suggested_args");
      });
    });
  });

  describe("with --force", () => {
    it("disables the last method, which the server allows", async ({ dir }) => {
      await writeProject(dir, aProject(PASSKEY_ONLY));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--force"));

      expect(result.exitCode).toBe(0);
    });

    it("writes the last method disabled", async ({ dir }) => {
      await writeProject(dir, aProject(PASSKEY_ONLY));

      await runCliForTest(authMethodJson(dir, "passkey", "disable", "--force"));

      expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(PASSKEY_ENTRY, { enabled: false });
    });

    it("warns that nobody can sign in afterwards", async ({ dir }) => {
      await writeProject(dir, aProject(PASSKEY_ONLY));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--force"));

      expect(parseJson(result.stdout)).toMatchObject({ warnings: [LEFT_WITHOUT_SIGN_IN] });
    });

    describe.skipIf(RUNS_AS_ROOT)("when the schema cannot be written", () => {
      it("fails", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));
        await chmod(join(dir, SCHEMA_FILE), 0o444);

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--force"));

        expect(parseJson(result.stdout)).toMatchObject({ status: "error" });
      });

      it("does not claim the change", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));
        await chmod(join(dir, SCHEMA_FILE), 0o444);

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--force"));

        expect(parseJson(result.stdout)).not.toHaveProperty("warnings");
      });
    });

    it("does not override a flow that still uses the method", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "password", "disable", "--force"));

      expect(parseJson(result.stdout)).toMatchObject({
        details: {
          issues: [expect.objectContaining({ rule: "schema/fields-resolve", step: "password" })],
        },
      });
    });
  });

  describe("with --dry-run", () => {
    it("still reports the warnings", async ({ dir }) => {
      await writeProject(dir, aProject(PASSWORD_ONLY, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "enable", "--dry-run"));

      expect(parseJson(result.stdout)).toMatchObject({ warnings: [PASSKEY_NOT_OFFERED] });
    });

    it("reports a skipped preview", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--dry-run"));

      expect(parseJson(result.stdout)).toMatchObject({ status: "skipped", reason: "dry-run" });
    });

    it("writes nothing", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      await runCliForTest(authMethodJson(dir, "passkey", "disable", "--dry-run"));

      expect(await readJson(dir, SCHEMA_FILE)).toHaveProperty(PASSKEY_ENTRY, { enabled: true });
    });

    it("lists the file it would change", async ({ dir }) => {
      await writeProject(dir, aProject(BOTH, aPasswordFlow()));

      const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--dry-run"));

      expect(parseJson(result.stdout)).toMatchObject({ data: { changed: [SCHEMA_FILE] } });
    });

    describe("when it would remove the last way to sign in", () => {
      it("exits 3, as the real run does", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--dry-run"));

        expect(result.exitCode).toBe(3);
      });

      it("refuses as the real run does", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--dry-run"));

        expect(parseJson(result.stdout)).toMatchObject(LAST_WAY_REFUSAL);
      });

      it("keeps the --force re-run a preview and suggests the real run's alternatives", async ({
        dir,
      }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(authMethodJson(dir, "passkey", "disable", "--dry-run"));

        expect(parseJson(result.stdout)).toMatchObject({
          next_commands: [
            expectedPublicCliCommand(
              `auth-method passkey disable --schema default-human-user --cwd ${dir} --force --dry-run`,
            ),
            expectedPublicCliCommand(
              `auth-method password enable --schema default-human-user --cwd ${dir}`,
            ),
          ],
        });
      });

      it("previews it with --force, and warns", async ({ dir }) => {
        await writeProject(dir, aProject(PASSKEY_ONLY));

        const result = await runCliForTest(
          authMethodJson(dir, "passkey", "disable", "--dry-run", "--force"),
        );

        expect(parseJson(result.stdout)).toMatchObject({
          status: "skipped",
          reason: "dry-run",
          warnings: [WOULD_BE_LEFT_WITHOUT_SIGN_IN],
        });
      });
    });
  });

  it.for([
    { case: "a refusal", documents: aProject(PASSKEY_ONLY) },
    { case: "a change", documents: aProject(BOTH, aPasswordFlow()) },
  ])("only suggests commands that exist after $case", async ({ documents }, { dir }) => {
    await writeProject(dir, documents);

    const result = await runCliForTest(authMethodJson(dir, "passkey", "disable"));

    const suggested = suggestedCommandIds(parseJson(result.stdout));
    expect(suggested).not.toHaveLength(0);
    expect(Object.keys(COMMANDS)).toEqual(expect.arrayContaining(suggested));
  });

  // It used to narrate "password is already enabled for …" and then close on
  // "Nothing to enable for …", which reads as two separate findings.
  it("says a method that is already on once, as the line it closes on", async ({ dir }) => {
    await writeProject(dir, aProject(BOTH, aPasswordFlow()));

    const result = await runCliForTest(authMethodText(dir, "password", "enable"));

    expect(stripAnsi(result.stdout)).not.toContain("password is already enabled for");
  });

  it("still closes on what it found when there was nothing to do", async ({ dir }) => {
    await writeProject(dir, aProject(BOTH, aPasswordFlow()));

    const result = await runCliForTest(authMethodText(dir, "password", "enable"));

    expect(stripAnsi(result.stdout)).toContain("Nothing to enable for default-human-user");
  });
});
