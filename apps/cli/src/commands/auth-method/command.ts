import { consola } from "consola";

import { ZitadelError } from "@/lib/errors";
import { optionArgs } from "@/lib/public-cli";
import { reportWarning } from "@/lib/warnings";
import { EnvironmentCommand } from "@/lib/oclif/environment-command";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { portableSuggestions, type SuggestedCommand } from "@/lib/suggestion";
import { nonBlankString } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import {
  type Change,
  type ConfigStore,
  DiskStore,
  type ForceOptions,
  NoSignInLeftError,
  type ToggleableMethod,
  type UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import type { JsonEnvelope } from "@/lib/oclif/types";
import { Destructive } from "@/lib/oclif/destructive";
import { prose } from "@/lib/oclif/rendering";

/** What every `auth-method` command reads before changing anything. */
export type SchemaTarget = {
  readonly cwd: string;
  readonly cwdArgs: string[];
  /** The whole configuration as the run read it, which every change is made on. */
  readonly config: ZitadelConfig;
  readonly store: ConfigStore;
  /** The schema the run changes. */
  readonly schema: UserSchema;
  /** The `--schema` value that names the schema and no other. */
  readonly schemaFlag: string;
};

/** What a schema pointing at an external URL is refused for. */
const EXTERNAL_SCHEMA_REFUSAL: Refusal = {
  message: "{file} points at an external schema",
  hint:
    "Its sign-in methods live in the schema at its url, which the server fetches. " +
    "Edit x-auth-methods there instead.",
  details: {
    file: "{file}",
    url: "{url}",
  },
};

/**
 * The schema the run is about, chosen by `--schema` or as the Project's only
 * one, and the login flows that run against it. A schema that points at an
 * external URL holds no sign-in methods of its own, so it is refused.
 */
export async function readSchemaTarget(input: {
  cwd: string;
  schema: string | undefined;
  cwdGiven: boolean;
}): Promise<SchemaTarget> {
  const store = new DiskStore(input.cwd);
  const config = await ZitadelConfig.loadUnchecked(store);
  const schema = selectSchema(config.schemas, input.schema);
  if (schema.isExternal) {
    throw refusalError(EXTERNAL_SCHEMA_REFUSAL, {
      file: schema.path,
      url: String(schema.body.url),
    });
  }
  return {
    cwd: input.cwd,
    cwdArgs: input.cwdGiven ? optionArgs("--cwd", input.cwd) : [],
    config,
    store,
    schema,
    schemaFlag: schemaFlagOf(config.schemas, schema),
  };
}

/** The message `deploy` needs, which only the caller can write. */
const DEPLOY_MESSAGE = "<what changed>";

/**
 * What the `auth-method` commands share (ADR 070): finding the schema, asking
 * before a change leaves nobody able to sign in, writing the change, saying
 * what the configuration said about it, and the result shape. The changes and
 * their refusals are the configuration's (`ZitadelConfig`). `auth-method
 * password` and `auth-method passkey` are nothing else, so {@link toggle} is
 * all they run.
 *
 * Only `auth-method sso enable` talks to a server, to store the provider's
 * credentials. Every other edit is local, and `deploy` publishes it like any
 * configuration change.
 */
export abstract class AuthMethodCommand extends Destructive(EnvironmentCommand) {
  // The environment flags are hidden here: most `auth-method` commands only
  // edit files and resolve no environment. The one that publishes credentials
  // to the project lists them among its own flags.
  static override baseFlags = {
    ...EnvironmentCommand.baseFlags,
    env: { ...environmentFlags.env, hidden: true } as typeof environmentFlags.env,
    "env-file": {
      ...environmentFlags["env-file"],
      hidden: true,
    } as (typeof environmentFlags)["env-file"],
    schema: nonBlankString({
      description:
        "User schema to change, by file name or objectType. Required when the Project has more than one.",
    }),
  };

  static override meta = {
    resolveServer: false,
    environment: false,
  };

  /**
   * The schema this run changes and the login flows that run against it. Every
   * `auth-method` command reads it first, before it asks or writes anything.
   */
  protected schemaTarget(flags: {
    schema?: string | undefined;
    cwd?: string | undefined;
  }): Promise<SchemaTarget> {
    return readSchemaTarget({
      cwd: this.cwd,
      schema: flags.schema,
      cwdGiven: flags.cwd !== undefined,
    });
  }

  /**
   * Make a change that may leave the schema with no way to sign in (ADR 070
   * §3). It is made without `force` first; when the configuration refuses it
   * with {@link NoSignInLeftError}, the person is asked, and a yes makes it
   * again with `force`. `--force` answers for them, and with nobody to ask and
   * no `--force` the run is refused.
   *
   * A dry run asks nobody: it writes nothing, so there is nothing to confirm,
   * and it shows the change as `--force` would make it. It still refuses where
   * the real run would refuse without asking, so a preview never passes a
   * change that then fails; its re-run keeps `--dry-run`.
   *
   * @param target - What the run read.
   * @param retryArgs - The command's own arguments, which a refusal suggests
   *   again with `--force`.
   * @param make - Makes the change, with or without `force`.
   * @returns The change, or `undefined` when the person said no.
   */
  protected async confirmIfNoSignInLeft(
    target: SchemaTarget,
    retryArgs: string[],
    make: (options: ForceOptions) => Change,
  ): Promise<Change | undefined> {
    try {
      return make({ force: this.meta.force === true });
    } catch (error) {
      if (!(error instanceof NoSignInLeftError)) {
        throw error;
      }
      const retry = [...retryArgs, ...target.cwdArgs, "--force"];
      const question = `Disable ${error.disabling} anyway? Nobody will be able to sign in to ${error.schema}.`;
      if (this.dryRun && this.meta.nonInteractive) {
        // The re-run stays a preview: --force with --dry-run writes nothing.
        refuseNoSignInLeft({
          target,
          error,
          question,
          retry: [...retry, "--dry-run"],
          cliVersion: this.cliVersion,
          json: this.isJson,
        });
      }
      if (this.dryRun) {
        return make({ force: true });
      }
      const consent = await this.consent({
        verb: "disable",
        name: `disable ${error.disabling}, the last way to sign in to ${error.schema}`,
        message: question,
        retry: portableSuggestions([retry], this.cliVersion)[0],
        refuse: () => {
          return refuseNoSignInLeft({
            target,
            error,
            question,
            retry,
            cliVersion: this.cliVersion,
            json: this.isJson,
          });
        },
      });
      if (consent === undefined) {
        return undefined;
      }
      return make({ force: true });
    }
  }

  /**
   * Write a change, saying each file it wrote.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @returns The paths written.
   */
  protected async write(target: SchemaTarget, change: Change): Promise<readonly string[]> {
    const written = await change.save(target.store);
    for (const path of written) {
      if (change.createdPaths.includes(path)) {
        consola.success(`Wrote ${path}`);
      } else {
        consola.success(`Updated ${path}`);
      }
    }
    return written;
  }

  /**
   * Tell the person what the configuration said about a change. Called once
   * the change is previewed or written, never before: a failed write must not
   * claim it.
   *
   * @param change - The change.
   */
  protected report(change: Change): void {
    for (const notice of change.notices) {
      if (notice.severity === "warning") {
        reportWarning(notice.message);
      } else {
        consola.info(notice.message);
      }
    }
  }

  /**
   * The follow-up commands of a result, as strings when every argument is
   * safe to run as written (the result's `next` commands), and always as
   * argument lists (its `next_args`).
   *
   * @param changed - Whether a file changed, which `deploy` then publishes.
   * @param cwdArgs - `--cwd` for `deploy`, from the run's target.
   * @param leading - Commands that come first, such as publishing a credential
   *   that did not reach the project.
   */
  protected followUps(
    changed: boolean,
    cwdArgs: string[],
    leading: string[][] = [],
  ): { commands: readonly SuggestedCommand[]; args: string[][] } {
    const deploys = [
      ["deploy", "--dry-run", ...cwdArgs],
      ["deploy", "-m", DEPLOY_MESSAGE, ...cwdArgs],
    ];
    const args = changed ? [...leading, ...deploys] : [...leading];
    return {
      // The message is a placeholder the caller fills in, so it is quoted in
      // the command string and listed as written in `next_args`.
      commands: portableSuggestions(args, this.cliVersion, [DEPLOY_MESSAGE]),
      args,
    };
  }

  /**
   * `auth-method password|passkey enable|disable`: set
   * `x-auth-methods.<method>.enabled` on one schema. Login flows are never
   * edited, so a change one of them would reject is refused instead.
   */
  protected async toggle(
    target: SchemaTarget,
    method: ToggleableMethod,
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    const { config, schema } = target;
    const verb = enabled ? "enable" : "disable";
    const done = enabled ? "Enabled" : "Disabled";
    const retryArgs = [
      "auth-method",
      method,
      "disable",
      ...optionArgs("--schema", target.schemaFlag),
    ];
    const change = await this.confirmIfNoSignInLeft(target, retryArgs, (options) => {
      if (enabled) {
        return config.enableMethod(schema, method);
      }
      return config.disableMethod(schema, method, options);
    });
    if (change === undefined) {
      return this.emit({
        status: "skipped",
        reason: "disable-cancelled",
      });
    }

    const edited = change.after.schema(schema.path) ?? schema;
    // Judged on the login journey: a passkey that a register step only
    // enrols is not offered to anyone signing in.
    const offered = !enabled || change.after.reachableMethods(edited).includes(method);
    const notOffered: readonly ToggleableMethod[] = offered ? [] : [method];
    const data = {
      schema: schema.name,
      file: schema.path,
      method,
      changed: [...change.changedPaths],
      usable: [...edited.usableMethods],
      not_offered: notOffered,
      notices: change.notices,
    };
    const unchanged = `Nothing to ${verb} for ${schema.name}`;

    if (this.dryRun) {
      this.report(change);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty: prose(change.changed ? `Would ${verb} ${method} for ${schema.name}` : unchanged),
      });
    }
    const written = await this.write(target, change);
    if (written.length === 0) {
      consola.info(`${method} is already ${verb}d for ${schema.name}`);
    }
    this.report(change);
    const followUps = this.followUps(change.changed, target.cwdArgs);

    return this.emit({
      status: "ok",
      data: { ...data, next_args: followUps.args },
      next: { commands: followUps.commands },
      pretty: prose(change.changed ? `${done} ${method} for ${schema.name}` : unchanged),
    });
  }
}

/**
 * Refuse leaving a schema with no way to sign in, without --force. The exact
 * re-run comes first, then enabling each method the schema could take
 * instead. Only `--json` names `details.suggested_args`: a person reads the
 * same commands under Next.
 */
function refuseNoSignInLeft(input: {
  target: SchemaTarget;
  error: NoSignInLeftError;
  question: string;
  retry: string[];
  cliVersion: string;
  json: boolean;
}): never {
  const { schemaFlag, cwdArgs } = input.target;
  const { error } = input;
  // Every suggestion as an argument list, the re-run first. The schema name
  // comes from a file name and the --cwd path from the user; one that would
  // need quoting leaves the strings out, because quoting differs between POSIX
  // shells, PowerShell and cmd.exe and none is safe on all of them.
  const suggestedArgs = [
    input.retry,
    ...error.alternatives.map((method) => {
      return ["auth-method", method, "enable", ...optionArgs("--schema", schemaFlag), ...cwdArgs];
    }),
  ];
  const where = input.json
    ? " (the first of details.suggested_args holds the exact arguments)."
    : ".";
  // Its --force retry is a consent only a person may give, as every gate's is.
  throw new ZitadelError("E_CONFIRMATION_REQUIRED", error.message, {
    hint:
      "Enable another method first, such as `zitadel auth-method sso enable --provider <name>`. " +
      "If the schema's users are only managed through the API, ask a person first: " +
      `${input.question} Re-run with --force only once they agree${where}`,
    details: {
      question: input.question,
      file: error.path,
      usable: [],
      suggested_args: suggestedArgs,
    },
    nextCommands: portableSuggestions(suggestedArgs, input.cliVersion),
  });
}

/**
 * How a schema is listed in a refusal: its file name, and its `objectType`
 * when that differs, since `--schema` takes either.
 *
 * @param schema - The schema.
 * @returns Its label.
 */
function labelOf(schema: UserSchema): string {
  if (schema.objectType === undefined || schema.objectType === schema.name) {
    return schema.name;
  }
  return `${schema.name} (${schema.objectType})`;
}

/**
 * The schemas a refusal names, for a script: each file name with its `objectType`.
 *
 * @param schemas - The schemas.
 * @returns Their names.
 */
function detailsOf(schemas: readonly UserSchema[]) {
  return schemas.map((schema) => {
    return { name: schema.name, object_type: schema.objectType ?? null };
  });
}

/**
 * The `--schema` value that names a schema and no other: its file name, or
 * `<file>.json` when that name is also another schema's `objectType`.
 *
 * @param schemas - Every schema.
 * @param schema - The one to name.
 * @returns The value.
 */
function schemaFlagOf(schemas: readonly UserSchema[], schema: UserSchema): string {
  const shadowed = schemas.some((other) => {
    return other !== schema && other.objectType === schema.name;
  });
  if (shadowed) {
    return `${schema.name}.json`;
  }
  return schema.name;
}

/**
 * Pick the schema to change. One schema is chosen without asking; several is
 * ambiguous, so the name has to be given. The name is the file name or the
 * schema's `objectType`; a name that fits more than one is refused rather than
 * guessed, and `<file>.json` names the file alone.
 *
 * @param schemas - Every schema.
 * @param requested - What `--schema` named, if anything.
 * @returns The schema.
 * @throws ZitadelError When there is none, the name matches none or several,
 *   or several exist and none is named.
 */
function selectSchema(schemas: readonly UserSchema[], requested: string | undefined): UserSchema {
  if (schemas.length === 0) {
    throw new ZitadelError(
      "E_NOT_FOUND",
      "This Project has no user schema under .zitadel/schemas",
      {
        hint: "Run `zitadel setup` first.",
      },
    );
  }
  if (requested === undefined) {
    const [only, ...rest] = schemas;
    if (rest.length > 0 || only === undefined) {
      throw new ZitadelError("E_VALIDATION", "This Project has more than one user schema", {
        hint: `Name the one to change with --schema. Known schemas: ${schemas.map(labelOf).join(", ")}`,
        details: {
          known: schemas.map((schema) => {
            return schema.name;
          }),
          schemas: detailsOf(schemas),
        },
      });
    }
    return only;
  }
  const byFile = requested.endsWith(".json");
  const wanted = byFile ? requested.slice(0, -".json".length) : requested;
  const matches = schemas.filter((schema) => {
    return schema.name === wanted || (!byFile && schema.objectType === wanted);
  });
  const [match, ...others] = matches;
  if (match === undefined) {
    throw new ZitadelError("E_NOT_FOUND", `This Project has no user schema named ${wanted}`, {
      hint: `Known schemas: ${schemas.map(labelOf).join(", ")}`,
      details: {
        requested: wanted,
        known: schemas.map((schema) => {
          return schema.name;
        }),
        schemas: detailsOf(schemas),
      },
    });
  }
  if (others.length > 0) {
    const byFileArgs = matches.map((schema) => {
      return optionArgs("--schema", schemaFlagOf(schemas, schema)).join(" ");
    });
    throw new ZitadelError(
      "E_VALIDATION",
      `More than one user schema is named ${wanted}: ${matches.map(labelOf).join(", ")}`,
      {
        hint: `Name the one to change by its file: ${byFileArgs.join(" or ")}`,
        details: {
          requested: wanted,
          candidates: matches.map((schema) => {
            return schema.name;
          }),
          schemas: detailsOf(matches),
        },
      },
    );
  }
  return match;
}
