import { mkdir } from "node:fs/promises";
import { runCommand } from "@tests/helpers/run-cli";
import { join } from "node:path";

import { beforeEach, describe, expect, vi } from "vitest";

import { Config, Errors } from "@oclif/core";

import { readSchemaTarget, type SchemaTarget } from "@/cli/commands/auth-method/command";
import AuthMethodPasskeyDisable from "@/cli/commands/auth-method/passkey/disable";
import AuthMethodSsoDisable from "@/cli/commands/auth-method/sso/disable";
import { Consent } from "@/lib/consent";
import { ZitadelError } from "@/lib/errors";

import { BrokenFilesError, type Change, DiskStore, Schemas, UserSchema } from "@/lib/zitadel";
import { answering, type Person } from "@tests/helpers/keyboard";
import { recordLog } from "@tests/helpers/log";
import { aSchema, SCHEMA_FILE } from "@tests/helpers/auth-method";
import { aLoginFlow, anOidcConnection, aUserSchema } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import {
  defaultSchema,
  makeProject,
  readJson,
  setUpProject,
  writeJson,
} from "@tests/helpers/local-project";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { asOneLine, asTerminal, useTerminal } from "@tests/helpers/terminal";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * The CLI's configuration, for running the command classes from source: the
 * built CLI bundles its own prompts, so a prompt can only be answered from here.
 */
const CONFIG = await Config.load({ root: cliPackageRoot });

/**
 * The warning a change that leaves the default schema no way to sign in ends with.
 */
const NO_WAY_TO_SIGN_IN =
  "default-human-user is left with no way to sign in. Its users can only be managed through the API.";

/**
 * The warning a dry run that would leave the default schema no way to sign in ends with.
 */
const WOULD_HAVE_NO_WAY_TO_SIGN_IN =
  "default-human-user would be left with no way to sign in. Its users can only be managed through the API.";

/**
 * The exit code of a run the person cancelled.
 */
const CANCELLED = 130;

/**
 * Where a change writes the new schema {@link aNewSchema} adds.
 */
const NEW_SCHEMA_FILE = ".zitadel/schemas/employees.json";

/**
 * A Project whose only enabled method is passkey, with no flows to stop the
 * change.
 *
 * @param dir - The directory to write the Project into.
 * @returns The Project's directory.
 */
function aPasskeyOnlyProject(dir: string): Promise<string> {
  return makeProject(dir, {
    schemas: {
      "default-human-user": aSchema({ password: { enabled: false }, passkey: { enabled: true } }),
    },
  });
}

/**
 * A Project whose only way to sign in is Google.
 *
 * @param dir - The directory to write the Project into.
 * @returns The Project's directory.
 */
function aGoogleOnlyProject(dir: string): Promise<string> {
  return makeProject(dir, {
    schemas: {
      "default-human-user": aSchema({
        password: { enabled: false },
        sso: { enabled: true, providers: ["google"] },
      }),
    },
  });
}

/**
 * The arguments of `auth-method passkey disable` run against the Project in `cwd`.
 *
 * @param cwd - The Project.
 * @param flags - Further flags.
 * @returns The arguments.
 */
function passkeyDisable(cwd: string, ...flags: string[]): string[] {
  return ["--cwd", cwd, "--no-telemetry", ...flags];
}

/**
 * The arguments of `auth-method sso disable --provider google` run against the
 * Project in `cwd`.
 *
 * @param cwd - The Project.
 * @returns The arguments.
 */
function googleDisable(cwd: string): string[] {
  return ["--provider", "google", "--cwd", cwd, "--no-telemetry"];
}

/**
 * The passkey command with its write reachable, to drive it without a run.
 */
class ChangeWriter extends AuthMethodPasskeyDisable {
  /** The command it stands in for, which its suggestions rebuild. */
  public static override id = "auth-method:passkey:disable";

  /**
   * Writes `change` to the Project `target` was read from.
   *
   * @param target - The schema the change is to.
   * @param change - The change.
   * @param consent - The consent for a change that removes the last way in.
   * @returns The paths written.
   */
  writeChange(target: SchemaTarget, change: Change, consent?: Consent): Promise<readonly string[]> {
    return this.write(target, change, consent);
  }

  /**
   * Makes a change that may leave no way to sign in, without a run.
   *
   * @param target - The schema the change is to.
   * @param make - Makes the change.
   * @returns The change with its consent, or `undefined` when the person said no.
   */
  confirming(target: SchemaTarget, make: () => Change): Promise<unknown> {
    return this.confirmIfNoSignInLeft(target, make);
  }
}

/**
 * A change that adds a new schema file to the Project.
 *
 * @param read - The Project as a run read it.
 * @returns The change.
 */
function aNewSchema(read: SchemaTarget): Change {
  return read.config.schemas.put(
    UserSchema.create({ path: NEW_SCHEMA_FILE, body: aSchema({ passkey: { enabled: true } }) }),
  );
}

/**
 * Reads the schema target of the Project in `cwd`, as a run with these flags would.
 *
 * @param cwd - The Project.
 * @param flags - The `--schema` the run named.
 * @returns The target.
 */
function target(cwd: string, flags: { schema?: string } = {}): Promise<SchemaTarget> {
  return readSchemaTarget({
    cwd,
    schema: flags.schema,
  });
}

/**
 * Everything the command wrote to the terminal and the console so far.
 *
 * @param talk - The person at the keyboard, who saw what was drawn on the terminal.
 * @returns What was drawn, then what went to stderr and the console.
 */
function printed(talk: Person): string {
  return [
    talk.shown(),
    talk.errors(),
    ...[...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map(
      (call) => {
        return String(call[0]);
      },
    ),
  ].join("\n");
}

useTerminal();

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => {
    return true;
  });
  vi.spyOn(console, "log").mockImplementation(() => {
    return undefined;
  });
  vi.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
});

describe("AuthMethodCommand", () => {
  describe("when disabling passkey would leave no way to sign in", () => {
    it("asks before going on", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const talk = answering(false);
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
      });

      expect(talk.asked()).toEqual([
        "Disable passkey anyway? Nobody will be able to sign in to default-human-user.",
      ]);
    });
  });

  describe("when disabling Google would leave no way to sign in", () => {
    it("asks, naming the provider and the schema", async ({ dir }) => {
      const cwd = await aGoogleOnlyProject(dir);

      const talk = answering(false);
      await asTerminal(() => {
        return AuthMethodSsoDisable.run(googleDisable(cwd), CONFIG);
      });

      expect(talk.asked()).toEqual([
        "Disable google anyway? Nobody will be able to sign in to default-human-user.",
      ]);
    });
  });

  describe("when the person declines to disable passkey", () => {
    it("ends as skipped", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering(false);
      const result = await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
      });

      expect(result).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    });

    it("says the schema is unchanged", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const talk = answering(false);
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
      });

      expect(asOneLine(printed(talk))).toContain(
        ".zitadel/schemas/default-human-user.json is unchanged, so passkey is still enabled for default-human-user.",
      );
    });

    it("leaves passkey enabled", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering(false);
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "passkey"], {
        enabled: true,
      });
    });
  });

  describe("when the person confirms disabling passkey", () => {
    it("ends ok, warning that nobody can sign in", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering(true);
      const result = await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
      });

      expect(result).toMatchObject({ status: "ok", warnings: [NO_WAY_TO_SIGN_IN] });
    });

    it("disables passkey", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering(true);
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "passkey"], {
        enabled: false,
      });
    });
  });

  describe("when the person declines to disable Google", () => {
    it("ends as skipped", async ({ dir }) => {
      const cwd = await aGoogleOnlyProject(dir);

      answering(false);
      const result = await asTerminal(() => {
        return AuthMethodSsoDisable.run(googleDisable(cwd), CONFIG);
      });

      expect(result).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    });

    it("says the schema is unchanged", async ({ dir }) => {
      const cwd = await aGoogleOnlyProject(dir);

      const talk = answering(false);
      await asTerminal(() => {
        return AuthMethodSsoDisable.run(googleDisable(cwd), CONFIG);
      });

      expect(asOneLine(printed(talk))).toContain(
        ".zitadel/schemas/default-human-user.json is unchanged, so google is still offered to default-human-user.",
      );
    });

    it("leaves Google enabled", async ({ dir }) => {
      const cwd = await aGoogleOnlyProject(dir);

      answering(false);
      await asTerminal(() => {
        return AuthMethodSsoDisable.run(googleDisable(cwd), CONFIG);
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "sso"], {
        enabled: true,
        providers: ["google"],
      });
    });
  });

  describe("when the person confirms disabling Google", () => {
    it("ends ok, warning that nobody can sign in", async ({ dir }) => {
      const cwd = await aGoogleOnlyProject(dir);

      answering(true);
      const result = await asTerminal(() => {
        return AuthMethodSsoDisable.run(googleDisable(cwd), CONFIG);
      });

      expect(result).toMatchObject({ status: "ok", warnings: [NO_WAY_TO_SIGN_IN] });
    });

    it("removes the provider", async ({ dir }) => {
      const cwd = await aGoogleOnlyProject(dir);

      answering(true);
      await asTerminal(() => {
        return AuthMethodSsoDisable.run(googleDisable(cwd), CONFIG);
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "sso"], {
        enabled: false,
      });
    });
  });

  describe("when the question is left unanswered", () => {
    it("fails with the exit code of every cancelled prompt", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const error = await rejectionOf(() => {
        answering();
        return asTerminal(() => {
          return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
        });
      });

      expect(error).toBeInstanceOf(Errors.ExitError);
      expect(error).toMatchObject({ oclif: { exit: CANCELLED } });
    });

    it("leaves passkey enabled", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      await rejectionOf(() => {
        answering();
        return asTerminal(() => {
          return AuthMethodPasskeyDisable.run(passkeyDisable(cwd), CONFIG);
        });
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "passkey"], {
        enabled: true,
      });
    });
  });

  describe("with --dry-run at a terminal", () => {
    it("does not ask", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const talk = answering();
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd, "--dry-run"), CONFIG);
      });

      expect(talk.asked()).toEqual([]);
    });

    it("previews the change and warns, rather than refusing", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering();
      const result = await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd, "--dry-run"), CONFIG);
      });

      expect(result).toMatchObject({
        status: "ok",
        data: { dry_run: true },
        warnings: [WOULD_HAVE_NO_WAY_TO_SIGN_IN],
      });
    });

    it("leaves passkey enabled", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering();
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd, "--dry-run"), CONFIG);
      });

      expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "passkey"], {
        enabled: true,
      });
    });
  });

  describe("with --force at a terminal", () => {
    it("does not ask", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const talk = answering();
      await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd, "--force"), CONFIG);
      });

      expect(talk.asked()).toEqual([]);
    });

    it("ends ok", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      answering();
      const result = await asTerminal(() => {
        return AuthMethodPasskeyDisable.run(passkeyDisable(cwd, "--force"), CONFIG);
      });

      expect(result).toMatchObject({ status: "ok" });
    });
  });

  describe("with --dry-run and nobody to ask", () => {
    /**
     * Runs `auth-method passkey disable` for a Project whose only method is
     * passkey, as a script, and reads the JSON it printed.
     *
     * @param cwd - The Project.
     * @param flags - Further flags.
     * @returns The error that ended it, if one did, and what it printed.
     */
    async function scripted(cwd: string, ...flags: string[]): Promise<unknown> {
      await rejectionOf(() => {
        return runCommand(
          AuthMethodPasskeyDisable,
          "auth-method:passkey:disable",
          passkeyDisable(cwd, "--non-interactive", "--json", ...flags),
        );
      });
      const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
      return JSON.parse(printed);
    }

    it("refuses, asking for a preview again with --force", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const printed = await scripted(cwd, "--dry-run");

      expect(printed).toMatchObject({
        status: "error",
        code: "E_CONFIRMATION_REQUIRED",
        details: {
          suggested_args: [
            [
              "auth-method",
              "passkey",
              "disable",
              "--schema",
              "default-human-user",
              "--force",
              "--dry-run",
              "--cwd",
              cwd,
            ],
            expect.anything(),
          ],
        },
      });
    });

    it("previews the change when --force answers for them", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      const printed = await scripted(cwd, "--dry-run", "--force");

      expect(printed).toMatchObject({ status: "ok", data: { dry_run: true } });
    });
  });

  describe("without --dry-run and nobody to ask", () => {
    it("refuses, with a retry that does not preview", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);

      await rejectionOf(() => {
        return runCommand(
          AuthMethodPasskeyDisable,
          "auth-method:passkey:disable",
          passkeyDisable(cwd, "--non-interactive", "--json"),
        );
      });

      expect(JSON.parse(vi.mocked(console.log).mock.calls.flat().join("\n"))).toMatchObject({
        code: "E_CONFIRMATION_REQUIRED",
        details: {
          suggested_args: [
            [
              "auth-method",
              "passkey",
              "disable",
              "--schema",
              "default-human-user",
              "--force",
              "--cwd",
              cwd,
            ],
            expect.anything(),
          ],
        },
      });
    });
  });

  describe("when making the change fails for another reason", () => {
    it("raises that failure as it is, without asking", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);
      const read = await target(cwd);
      const talk = answering();
      const unrelated = new Error("the flows are broken");

      const error = await rejectionOf(() => {
        return new ChangeWriter([], CONFIG).confirming(read, () => {
          throw unrelated;
        });
      });

      expect(error).toBe(unrelated);
      expect(talk.asked()).toEqual([]);
    });
  });

  describe("when run from inside the Project", () => {
    it("suggests a dry run and a deploy without --cwd", async ({ dir }) => {
      const cwd = await aPasskeyOnlyProject(dir);
      await writeJson(
        cwd,
        SCHEMA_FILE,
        aSchema({ password: { enabled: true }, passkey: { enabled: true } }),
      );
      vi.spyOn(process, "cwd").mockReturnValue(cwd);

      const envelope = await AuthMethodPasskeyDisable.run(
        ["--no-telemetry", "--non-interactive"],
        CONFIG,
      );

      expect(envelope).toMatchObject({
        data: {
          next_args: [
            ["deploy", "--dry-run"],
            ["deploy", "--message", "<what changed>"],
          ],
        },
      });
    });
  });
});

describe("AuthMethodCommand.write", () => {
  it("says it wrote a file the change creates", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const recorded = recordLog();

    await writer.writeChange(read, aNewSchema(read));

    recorded.stop();
    expect(recorded.said).toEqual([{ level: "done", text: `Wrote ${NEW_SCHEMA_FILE}` }]);
  });

  it("says it updated a file the change edits", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const recorded = recordLog();

    await writer.writeChange(read, read.config.schemas.enable(read.schema, "password"));

    recorded.stop();
    expect(recorded.said).toEqual([{ level: "done", text: `Updated ${SCHEMA_FILE}` }]);
  });

  it("says it removed a file the change deletes", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const recorded = recordLog();

    await writer.writeChange(read, read.config.schemas.remove(SCHEMA_FILE));

    recorded.stop();
    expect(recorded.said).toEqual([{ level: "done", text: `Removed ${SCHEMA_FILE}` }]);
  });

  it("writes the change to the Project", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);

    await writer.writeChange(read, read.config.schemas.enable(read.schema, "password"));

    expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "password"], {
      enabled: true,
    });
  });

  it("refuses a change that removes the last way in without consent", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const change = read.config.schemas.disable(read.schema, "passkey", { force: true });

    const error = await rejectionOf(() => {
      return writer.writeChange(read, change);
    });

    expect(error).toEqual(new Error("A destructive operation ran without consent"));
  });

  it("writes a change that removes the last way in with consent", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const change = read.config.schemas.disable(read.schema, "passkey", { force: true });
    const consent = await Consent.request(
      { verb: "disable", name: "disable passkey", message: "Disable passkey?" },
      { interactive: false, force: true, dryRun: false },
    );

    await writer.writeChange(read, change, consent);

    expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty(["x-auth-methods", "passkey"], {
      enabled: false,
    });
  });

  it("writes an edit to a schema that had no way to sign in without consent", async ({ dir }) => {
    const cwd = await makeProject(dir, {
      schemas: {
        "default-human-user": aSchema({
          password: { enabled: false },
          passkey: { enabled: false },
        }),
      },
    });
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const edited = UserSchema.create({
      path: read.schema.path,
      body: { ...read.schema.body, title: "People" },
    });

    await writer.writeChange(read, read.config.schemas.put(edited));

    expect(await readJson(cwd, SCHEMA_FILE)).toHaveProperty("title", "People");
  });

  it("returns the paths it wrote", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);

    const written = await writer.writeChange(read, aNewSchema(read));

    expect(written).toEqual([NEW_SCHEMA_FILE]);
  });

  it("says nothing for a change that writes nothing", async ({ dir }) => {
    const cwd = await aPasskeyOnlyProject(dir);
    const read = await target(cwd);
    const writer = new ChangeWriter([], CONFIG);
    const recorded = recordLog();

    await writer.writeChange(read, read.config.schemas.enable(read.schema, "passkey"));

    recorded.stop();
    expect(recorded.said).toEqual([]);
  });
});

describe("readSchemaTarget", () => {
  describe("with one schema", () => {
    it("finds it, pinning no --schema for the follow-ups", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const read = await target(cwd);

      expect(read).toMatchObject({
        schema: { name: "default-human-user" },
        schemaGiven: undefined,
      });
    });

    it("carries --schema into the follow-ups when the run had one", async ({ dir }) => {
      const cwd = await setUpProject(dir);

      const read = await target(cwd, { schema: "default-human-user" });

      expect(read).toMatchObject({ schemaGiven: "default-human-user" });
    });
  });

  describe("with more than one schema", () => {
    it("chooses the one --schema names", async ({ dir }) => {
      const cwd = await setUpProject(dir, { customers: defaultSchema, employees: defaultSchema });

      const read = await target(cwd, { schema: "employees" });

      expect(read).toMatchObject({ schema: { name: "employees" } });
    });

    it("chooses the one whose objectType --schema names, as a flow's user_schema does", async ({
      dir,
    }) => {
      const cwd = await setUpProject(dir, {
        customers: { ...defaultSchema, objectType: "customer" },
        employees: { ...defaultSchema, objectType: "employee" },
      });

      const read = await target(cwd, { schema: "employee" });

      expect(read).toMatchObject({ schema: { name: "employees" } });
    });

    it("refuses a Project with none named", async ({ dir }) => {
      const cwd = await setUpProject(dir, { customers: defaultSchema, employees: defaultSchema });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: "This project has more than one user schema",
      });
    });
  });

  describe("with a schema whose file name is another schema's objectType", () => {
    /**
     * Two schemas that `human-user` names both of: one by its objectType, the
     * other by its file.
     */
    const AMBIGUOUS = {
      "default-human-user": defaultSchema,
      "human-user": { ...defaultSchema, objectType: "staff" },
    };

    it("refuses that name, suggesting each schema by its file", async ({ dir }) => {
      const cwd = await setUpProject(dir, AMBIGUOUS);

      const error = await rejectionOf(() => {
        return target(cwd, { schema: "human-user" });
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message:
          "More than one user schema is named human-user: default-human-user (human-user), human-user (staff)",
        hint: "Name the one to change by its file: --schema default-human-user or --schema human-user.json",
        details: { requested: "human-user", candidates: ["default-human-user", "human-user"] },
      });
    });

    it("chooses the schema that name is the file of, given with .json", async ({ dir }) => {
      const cwd = await setUpProject(dir, AMBIGUOUS);

      const read = await target(cwd, { schema: "human-user.json" });

      expect(read).toMatchObject({ schema: { name: "human-user" }, schemaFlag: "human-user.json" });
    });

    it("names the other schema by its file alone, which is unambiguous", async ({ dir }) => {
      const cwd = await setUpProject(dir, AMBIGUOUS);

      const read = await target(cwd, { schema: "default-human-user" });

      expect(read).toMatchObject({ schemaFlag: "default-human-user" });
    });
  });

  describe("with schemas that declare an objectType", () => {
    /**
     * Two schemas, one whose objectType differs from its file name.
     */
    const TYPED = {
      customers: { ...defaultSchema, objectType: "customer" },
      employees: { ...defaultSchema, objectType: "employees" },
    };

    it("lists each by file and objectType when none is named", async ({ dir }) => {
      const cwd = await setUpProject(dir, TYPED);

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: "This project has more than one user schema",
        hint: "Name the one to change with --schema. Known schemas: customers (customer), employees",
      });
    });

    it("lists each by file and objectType when the named one does not exist", async ({ dir }) => {
      const cwd = await setUpProject(dir, TYPED);

      const error = await rejectionOf(() => {
        return target(cwd, { schema: "staff" });
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_NOT_FOUND",
        message: "This project has no user schema named staff",
        hint: "Known schemas: customers (customer), employees",
        details: {
          known: ["customers", "employees"],
          schemas: [
            { name: "customers", object_type: "customer" },
            { name: "employees", object_type: "employees" },
          ],
        },
      });
    });
  });

  describe("with no schema", () => {
    it("refuses the Project before reading a state file it cannot read", async ({ dir }) => {
      const cwd = await makeProject(dir);
      await writeJson(cwd, ".zitadel/state.json", { resources: [] });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_NOT_FOUND" });
    });

    it("suggests setting the Project up", async ({ dir }) => {
      const cwd = await makeProject(dir);

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toMatchObject({ nextCommands: [{ id: "setup" }] });
    });
  });

  describe("with a schema that points at an external url", () => {
    it("refuses it, naming the file and the url", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: {
          remote: { kind: "schema-url", url: "https://schemas.test.invalid/remote.json" },
        },
      });
      await writeJson(cwd, ".zitadel/state.json", { resources: [] });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: ".zitadel/schemas/remote.json points at an external schema",
        details: {
          file: ".zitadel/schemas/remote.json",
          url: "https://schemas.test.invalid/remote.json",
        },
      });
    });
  });

  describe("with a schema file its contract refuses", () => {
    it("names the broken file when it is the only schema", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { customers: aUserSchema({ objectType: 7 }) },
      });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(BrokenFilesError);
      expect(error).toMatchObject({
        problems: [expect.objectContaining({ path: ".zitadel/schemas/customers.json" })],
      });
    });

    it("names the broken file when --schema names it", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { customers: defaultSchema, employees: aUserSchema({ objectType: 7 }) },
      });

      const error = await rejectionOf(() => {
        return target(cwd, { schema: "employees" });
      });

      expect(error).toBeInstanceOf(BrokenFilesError);
      expect(error).toMatchObject({
        problems: [expect.objectContaining({ path: ".zitadel/schemas/employees.json" })],
      });
    });
  });

  describe("with several valid schemas and one its contract refuses", () => {
    it("refuses the ambiguity when no --schema is given, not the broken file", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: {
          customers: defaultSchema,
          partners: defaultSchema,
          employees: aUserSchema({ objectType: 7 }),
        },
      });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).not.toBeInstanceOf(BrokenFilesError);
      expect(error).toMatchObject({
        message: "This project has more than one user schema",
      });
    });

    it("names the broken file when --schema names it", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: {
          customers: defaultSchema,
          partners: defaultSchema,
          employees: aUserSchema({ objectType: 7 }),
        },
      });

      const error = await rejectionOf(() => {
        return target(cwd, { schema: "employees.json" });
      });

      expect(error).toBeInstanceOf(BrokenFilesError);
    });

    it("refuses a name no schema has as unknown, not as the broken file", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { customers: defaultSchema, employees: aUserSchema({ objectType: 7 }) },
      });

      const error = await rejectionOf(() => {
        return target(cwd, { schema: "partners" });
      });

      expect(error).toMatchObject({
        message: "This project has no user schema named partners",
      });
    });
  });

  describe("when choosing the schema fails for a reason that is no refusal", () => {
    it("raises that failure, not the broken file", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { customers: aUserSchema({ objectType: 7 }) },
      });
      const unrelated = new TypeError("not a refusal");
      vi.spyOn(Schemas.prototype, "resolve").mockImplementation(() => {
        throw unrelated;
      });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBe(unrelated);
    });
  });

  describe("with a file of another kind its contract refuses", () => {
    it("refuses the run, naming the file", async ({ dir }) => {
      const cwd = await makeProject(dir, { schemas: { customers: defaultSchema } });
      await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
      await writeJson(cwd, ".zitadel/idps/broken.json", anOidcConnection({ protocol: "saml" }));

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(BrokenFilesError);
      expect(error).toMatchObject({
        problems: expect.arrayContaining([
          expect.objectContaining({ path: ".zitadel/idps/broken.json" }),
        ]),
      });
    });
  });

  describe("with a state file", () => {
    it("finds the flows that name the schema by the id it was published as", async ({ dir }) => {
      const cwd = await makeProject(dir, {
        schemas: { customers: { ...defaultSchema, $id: "https://a.test/customers.json" } },
        flows: { login: aLoginFlow({ name: "login", userSchema: "sch_PUBLISHED" }) },
      });
      await writeJson(cwd, ".zitadel/state.json", {
        resources: { ".zitadel/schemas/customers.json": { id: "sch_PUBLISHED" } },
      });

      const read = await target(cwd);

      expect(read.config.flows.findForSchema(read.schema)).toEqual([
        expect.objectContaining({ path: ".zitadel/flows/login.json" }),
      ]);
    });

    it("reads the configuration once", async ({ dir }) => {
      const cwd = await makeProject(dir, { schemas: { customers: defaultSchema } });
      await writeJson(cwd, ".zitadel/state.json", {
        resources: { ".zitadel/schemas/customers.json": { id: "sch_PUBLISHED" } },
      });
      const reads = vi.spyOn(DiskStore.prototype, "read");

      await target(cwd);

      expect(
        reads.mock.calls.filter(([kind]) => {
          return kind === "schemas";
        }),
      ).toHaveLength(1);
    });

    it("ignores a malformed entry the state holds for another schema", async ({ dir }) => {
      const cwd = await makeProject(dir, { schemas: { customers: defaultSchema } });
      await writeJson(cwd, ".zitadel/state.json", {
        resources: { ".zitadel/schemas/other.json": { id: 7 } },
      });

      const read = await target(cwd);

      expect(read.schema.path).toBe(".zitadel/schemas/customers.json");
    });

    it("refuses one it cannot read rather than guess the schema's flows", async ({ dir }) => {
      const cwd = await makeProject(dir, { schemas: { customers: defaultSchema } });
      await writeJson(cwd, ".zitadel/state.json", { resources: [] });

      const error = await rejectionOf(() => {
        return target(cwd);
      });

      expect(error).toBeInstanceOf(ZitadelError);
      expect(error).toMatchObject({ code: "E_VALIDATION" });
    });
  });
});
