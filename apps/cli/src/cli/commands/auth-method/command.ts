import type { Interfaces } from "@oclif/core";
import { CUSTOM_PROVIDER, IDP_PROVIDERS } from "@zitadel/config/idp";

import { environmentFlags } from "@/cli/core/environment-flags";
import { nonBlankString } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import type { Admitted } from "@/cli/core/base";
import type { CommandResult } from "@/cli/core/types";
import { Destructive } from "@/cli/core/destructive";
import { Cmd } from "@/lib/cmd";
import { Consent } from "@/lib/consent";
import { ZitadelError } from "@/lib/errors";
import type { Facts } from "@/cli/core/base";
import { type SuggestedCommand, WHAT_CHANGED } from "@/lib/suggestion";
import { publishedIds } from "@/lib/sync/state";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Output, warnings } from "@/lib/ui";
import {
  ZitadelConfigError,
  ZitadelConfigSchemaAmbiguousError,
  type Change,
  CONFIG_DIRECTORIES,
  type ConfigStore,
  DiskStore,
  type ForceOptions,
  ZitadelConfigEditLockoutError,
  ZitadelConfigFlowMethodInUseError,
  ZitadelConfigFlowBrokenError,
  ZitadelConfigFlowUncheckedError,
  ZitadelConfigSchemaMissingError,
  type Schemas,
  type ToggleableMethod,
  type UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import { Promptable } from "@/cli/core/promptable";
import { ChangeCommand } from "@/cli/commands/bases";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Telemetered } from "@/cli/telemetry/telemetered";

/**
 * What every `auth-method` command reads before changing anything.
 */
export type SchemaTarget = {
  readonly cwd: string;

  /**
   * The whole configuration as the run read it, which every change is made on.
   */
  readonly config: ZitadelConfig;
  readonly store: ConfigStore;

  /**
   * The schema the run changes.
   */
  readonly schema: UserSchema;

  /**
   * The `--schema` value that names the schema and no other.
   */
  readonly schemaFlag: string;

  /**
   * `--schema` as the run was given it: `undefined` when the schema was the
   * Project's only one, so a command that repeats the run does not pin a
   * choice nobody made.
   */
  readonly schemaGiven: string | undefined;
};

/**
 * The flags every `auth-method` command reads its schema by.
 */
type SchemaFlags = {
  /**
   * The schema `--schema` names, if any.
   */
  readonly schema?: string | undefined;
};

/**
 * What a change that turns off a method a login flow still uses is refused for.
 */
const FLOW_METHOD_IN_USE_REFUSAL = {
  message: "{message}",
  hint: "Edit those steps first; login flows are not edited for you. `zitadel deploy --dry-run` checks the edited flow; then run the command again.",
  next: [
    {
      id: "deploy",
      flags: {
        dryRun: true,
      },
    },
  ],
} as const satisfies Refusal;

/**
 * What a change is refused for when it would make a login flow stop validating.
 */
const FLOW_BROKEN_REFUSAL = {
  message: "{message}",
  hint: "Fix the steps named above, then run the command again.",
} as const satisfies Refusal;

/**
 * What a change is refused for when a login flow has errors that keep it from
 * being checked against the changed schema.
 */
export const FLOW_UNCHECKED_REFUSAL = {
  message: "{message}",
  hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
  next: [
    {
      id: "deploy",
      flags: {
        dryRun: true,
      },
    },
  ],
} as const satisfies Refusal;

/**
 * What a schema pointing at an external URL is refused for.
 */
const EXTERNAL_SCHEMA_REFUSAL = {
  message: "{file} points at an external schema",
  hint: "Its sign-in methods live in the schema at its url, which the server fetches. Edit x-auth-methods there instead.",
  details: {
    file: "{file}",
    url: "{url}",
  },
} as const satisfies Refusal;

/**
 * What a Project with no user schema at all is refused for.
 */
const NO_SCHEMA_REFUSAL = {
  code: "E_NOT_FOUND",
  message: "This project has no user schema under .zitadel/schemas",
  hint: "Set the project up first.",
  next: [{ id: "setup" }],
} as const satisfies Refusal;

/**
 * What a `--schema` that names no schema is refused for.
 */
const UNKNOWN_SCHEMA_REFUSAL = {
  code: "E_NOT_FOUND",
  message: "This project has no user schema named {requested}",
  hint: "Known schemas: {labels}",
  details: {
    requested: "{requested}",
    known: "{known}",
    schemas: "{schemas}",
  },
} as const satisfies Refusal;

/**
 * What a run that names no schema, where there are several, is refused for.
 */
const UNNAMED_SCHEMA_REFUSAL = {
  message: "This project has more than one user schema",
  hint: "Name the one to change with --schema. Known schemas: {labels}",
  details: {
    known: "{known}",
    schemas: "{schemas}",
  },
} as const satisfies Refusal;

/**
 * What a `--schema` that more than one schema answers to is refused for.
 */
const AMBIGUOUS_SCHEMA_REFUSAL = {
  message: "More than one user schema is named {requested}: {labels}",
  hint: "Name the one to change by its file: {flags}",
  details: {
    requested: "{requested}",
    candidates: "{candidates}",
    schemas: "{schemas}",
  },
} as const satisfies Refusal;

/**
 * The schema the run is about, chosen by `--schema` or as the Project's only
 * one, and the login flows that run against it.
 *
 * @remarks
 * A schema that points at an external URL holds no sign-in methods of its
 * own, so it is refused. A deployed flow may name its schema by the id the
 * platform assigned it, which only `.zitadel/state.json` records, so the
 * configuration every change is made on is read knowing the ids the chosen
 * schema was published as, and no others: the schema is chosen from the files
 * first, so a refusal about the schema comes before anything else, the state
 * file included. Only the chosen schema's ids are read, so an entry the state
 * holds for another schema is no concern of this run, and the files are read
 * once: the schema chosen from them stands, because the ids only matter to the
 * flows. Every file is held to its contract, so a broken file is refused rather
 * than left out of what the run edits.
 *
 * A broken schema file is no schema, so a Project whose only (or named)
 * schema is broken would be told it has none. When no schema can be chosen
 * because the file that would have been is broken, the broken file is what the
 * person has to fix, so that is what is refused: with no `--schema`, every
 * broken schema file, since none is valid; with one, those named by it. Any
 * other way of failing to choose, such as several valid schemas and none named,
 * is refused as it is, whatever else is broken: the broken file is reported
 * once a schema is chosen.
 *
 * @param input - The run's directory and what `--schema` named.
 * @returns What the run read.
 * @throws {@link ZitadelError} When no schema, or more than one, fits
 *   `--schema`, or the one that does points at an external schema.
 * @throws {@link ZitadelConfigError} Naming every file the contract rules refuse.
 */
export async function readSchemaTarget(input: {
  cwd: string;
  schema: string | undefined;
}): Promise<SchemaTarget> {
  const store = new DiskStore(input.cwd);
  const loaded = await ZitadelConfig.loadUnchecked(store);
  try {
    loaded.schemas.resolve(input.schema);
  } catch (error) {
    if (error instanceof ZitadelConfigSchemaMissingError) {
      const brokenSchemas = loaded.broken.filter((file) => {
        return file.kind === "schema";
      });
      const name = input.schema?.endsWith(".json")
        ? input.schema.slice(0, -".json".length)
        : input.schema;
      const broken =
        input.schema === undefined
          ? brokenSchemas
          : brokenSchemas.filter((file) => {
              return file.path === `${CONFIG_DIRECTORIES.schemas}/${name}.json`;
            });
      if (broken.length > 0) {
        throw new ZitadelConfigError(
          [
            "Configuration files are not valid:",
            ...broken
              .flatMap((file) => {
                return file.problems;
              })
              .map((entry) => {
                return `  - ${entry.path}: ${entry.problem}`;
              }),
          ].join("\n"),
        );
      }
    }
  }
  const schema = chosenSchema(loaded.schemas, input.schema);
  if (schema.isExternal) {
    throw refusalError(EXTERNAL_SCHEMA_REFUSAL, {
      file: schema.path,
      url: String(schema.body.url),
    });
  }
  const published = await publishedIds(input.cwd, [schema.path]);
  const config = loaded.withOptions({ published }).refuseBroken(store);
  const schemaFlag = config.schemas.nameUniquely(schema);
  return {
    cwd: input.cwd,
    config,
    store,
    schema,
    schemaFlag,
    schemaGiven: input.schema === undefined ? undefined : schemaFlag,
  };
}

/**
 * A result's follow-up commands, as strings and as argument lists.
 */
export type FollowUps = {
  /**
   * The commands, when every argument is safe to run as written.
   */
  readonly commands: readonly SuggestedCommand[];

  /**
   * The same commands as argument lists, always (`next_args`).
   */
  readonly args: readonly (readonly string[])[];
};

/**
 * The shared environment flags, hidden: most `auth-method` commands only edit
 * files and resolve no environment.
 *
 * @remarks
 * Typed as the shared flags, so the one command that lists them again
 * (`auth-method sso enable`) declares the same flags, only shown.
 */
const HIDDEN_ENVIRONMENT_FLAGS: Pick<typeof environmentFlags, "env" | "env-file"> = {
  env: {
    ...environmentFlags.env,
    hidden: true,
  },
  "env-file": {
    ...environmentFlags["env-file"],
    hidden: true,
  },
};

/**
 * What {@link refuseNoSignInLeft} words its refusal from.
 */
type NoSignInLeftRefusal = {
  readonly error: ZitadelConfigEditLockoutError;
  readonly question: string;
  /** The exact re-run first, then enabling each method the schema could take instead, then a provider. */
  readonly suggested: FollowUps;
};

/**
 * Refuse leaving a schema with no way to sign in, without --force.
 *
 * @remarks
 * The exact re-run comes first, then enabling each method the schema could
 * take instead, then a social sign-in provider. Only `--json` names `details.suggested_args`: a person reads
 * the same commands under Next. Its --force retry is a consent only a person
 * may give, as every gate's is.
 *
 * @param input - The run, the refusal, the question a person would be asked,
 *   and the re-run.
 * @throws {@link ZitadelError} With `E_CONFIRMATION_REQUIRED`, always.
 */
function refuseNoSignInLeft(input: NoSignInLeftRefusal): never {
  const error = input.error;
  const where = Output.json
    ? " (the first of details.suggested_args holds the exact arguments)."
    : ".";
  throw new ZitadelError("E_CONFIRMATION_REQUIRED", error.message, {
    hint: `Enable another method first. If the schema's users are only managed through the API, ask a person first: ${input.question} Re-run with --force only once they agree${where}`,
    details: {
      question: input.question,
      file: error.path,
      usable: error.usable,
      suggested_args: input.suggested.args,
    },
    nextCommands: input.suggested.commands,
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
function detailsOf(
  schemas: readonly UserSchema[],
): readonly { name: string; object_type: string | null }[] {
  return schemas.map((schema) => {
    return {
      name: schema.name,
      object_type: schema.objectType ?? null,
    };
  });
}

/**
 * The file names of some schemas.
 *
 * @param schemas - The schemas.
 * @returns Each one's name.
 */
function namesOf(schemas: readonly UserSchema[]): readonly string[] {
  return schemas.map((schema) => {
    return schema.name;
  });
}

/**
 * The schema `--schema` picks, as the configuration chooses it, with every way
 * the configuration cannot choose one refused in the command's words.
 * `resolve` misses a name only when one was given: with
 * none, it either has no schema at all or finds several.
 *
 * @param schemas - Every schema.
 * @param requested - What `--schema` named, if anything.
 * @returns The schema.
 * @throws {@link ZitadelError} When there is none, the name matches none or
 *   several, or several exist and none is named.
 */
function chosenSchema(schemas: Schemas, requested: string | undefined): UserSchema {
  try {
    return schemas.resolve(requested);
  } catch (error) {
    if (error instanceof ZitadelConfigSchemaMissingError) {
      if (error.known.length === 0 || requested === undefined) {
        throw refusalError(NO_SCHEMA_REFUSAL, {});
      }
      throw refusalError(UNKNOWN_SCHEMA_REFUSAL, {
        requested,
        labels: error.known.map(labelOf).join(", "),
        known: namesOf(error.known),
        schemas: detailsOf(error.known),
      });
    }
    if (error instanceof ZitadelConfigSchemaAmbiguousError) {
      if (requested === undefined) {
        throw refusalError(UNNAMED_SCHEMA_REFUSAL, {
          labels: error.candidates.map(labelOf).join(", "),
          known: namesOf(error.candidates),
          schemas: detailsOf(error.candidates),
        });
      }
      const flags = error.candidates.map((schema) => {
        return Cmd.optionArgs("--schema", schemas.nameUniquely(schema)).join(" ");
      });
      throw refusalError(AMBIGUOUS_SCHEMA_REFUSAL, {
        requested,
        labels: error.candidates.map(labelOf).join(", "),
        flags: flags.join(" or "),
        candidates: namesOf(error.candidates),
        schemas: detailsOf(error.candidates),
      });
    }
    throw error;
  }
}

/**
 * The kind of identity provider a command was asked about: the catalog's name
 * for it, or `custom` for any other, never the name a developer gave a
 * connection.
 *
 * @param provider - What `--provider` was given.
 * @returns The kind, or nothing when none was given.
 */
export function providerKind(provider: unknown): string | undefined {
  if (typeof provider !== "string") {
    return undefined;
  }

  return (IDP_PROVIDERS as readonly string[]).includes(provider) ? provider : CUSTOM_PROVIDER;
}

/**
 * What the `auth-method` commands share (ADR 070): finding the schema, asking
 * before a change leaves nobody able to sign in, writing the change, saying
 * what the configuration said about it, and the result shape. The changes and
 * their refusals are the configuration's (`ZitadelConfig`). `auth-method
 * password` and `auth-method passkey` are nothing else, so {@link applyToggle} is
 * all they run.
 *
 * Only `auth-method sso enable` talks to a server, to store the provider's
 * credentials. Every other edit is local, and `deploy` publishes it like any
 * configuration change.
 */
export abstract class AuthMethodCommand extends Telemetered(Promptable(ChangeCommand)) {
  /**
   * Whether the command takes `--json`, as the class it extends says. oclif
   * merges a command's statics up its chain only while each class declares one
   * of its own, so a class that declares statics under a mixin that declares
   * none, as this one does, says it itself.
   */
  static override enableJsonFlag = ChangeCommand.enableJsonFlag;

  /**
   * The flags every `auth-method` command takes. The environment flags are
   * hidden here: most `auth-method` commands only edit files and resolve no
   * environment, and the one that publishes credentials to the project lists
   * them among its own flags.
   */
  static override baseFlags = {
    ...super.baseFlags,
    ...HIDDEN_ENVIRONMENT_FLAGS,
    schema: nonBlankString({
      description:
        "User schema to change, by file name or objectType. Required when the project has more than one.",
    }),
  };

  /**
   * Legacy: for a command that reads no environment (`meta.environment` false),
   * `--server` is accepted and ignored, so the run names no server. One that
   * reads an environment (`sso enable`) resolves it as every command does.
   *
   * @param cwd - The directory the run addresses.
   * @param serverFlag - What `--server` was given, if it was.
   * @returns The run's server.
   */
  protected override async resolveServer(
    cwd: string,
    serverFlag: string | undefined,
  ): Promise<string> {
    const { meta } = this.constructor as typeof AuthMethodCommand;
    if (meta.environment === false) {
      return "";
    } else {
      return super.resolveServer(cwd, serverFlag);
    }
  }

  static override meta = {
    environment: false,
  };

  /**
   * Which sign-in method the command changes, taken from its name, and that it
   * ran on its own.
   *
   * @returns The facts, with the layers below.
   */
  protected override describe(): Facts {
    return {
      ...super.describe(),
      method: this.id?.split(":")[1],
      entry_point: "standalone",
    };
  }

  /**
   * The schema this run changes and the login flows that run against it. Every
   * `auth-method` command reads it first, before it asks or writes anything.
   *
   * @param flags - The run's `--schema` and `--cwd`.
   * @returns What the run read.
   * @throws {@link ZitadelError} When no schema, or more than one, fits
   *   `--schema`, or the one that does points at an external schema.
   */
  protected loadSchemaTarget(flags: SchemaFlags): Promise<SchemaTarget> {
    return readSchemaTarget({
      cwd: this.cwd,
      schema: flags.schema,
    });
  }

  /**
   * Write a change, saying each file it wrote.
   *
   * @remarks
   * A change that leaves the schema no way to sign in takes the consent
   * {@link confirmIfNoSignInLeft} asked for, and is checked here: a caller
   * cannot write one without it.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @param consent - The consent for a change that removes the schema's last
   *   way to sign in; `undefined` for any other.
   * @returns The paths written.
   * @throws When a file cannot be written, or the change removes the last way
   *   to sign in and `consent` is not a {@link Consent}.
   */
  protected async write(
    target: SchemaTarget,
    change: Change,
    consent: Consent | undefined,
  ): Promise<readonly string[]> {
    const edited = change.after.schemas.get(target.schema.path);
    if (
      edited !== undefined &&
      change.after.schemas.removesLastWayIn({
        before: change.before,
        after: change.after,
        original: target.schema,
        edited,
      })
    ) {
      Consent.assert(consent);
    }
    if (change.changed) {
      this.info("Updating the project's files");
    }
    const written = await change.save(target.store);
    for (const path of written) {
      if (change.createdPaths.includes(path)) {
        this.debug(`Wrote ${escapeControlCharacters(path)}`);
      } else {
        this.debug(`Updated ${escapeControlCharacters(path)}`);
      }
    }
    for (const path of change.removedPaths) {
      this.debug(`Removed ${escapeControlCharacters(path)}`);
    }
    return written;
  }

  /**
   * Tell the person what the configuration said about a change.
   *
   * @remarks
   * Called once the change is previewed or written, never before: a failed
   * write must not claim it.
   *
   * @param change - The change.
   */
  protected report(change: Change): void {
    for (const notice of change.notices) {
      if (notice.severity === "warning") {
        warnings.report(notice.message);
      } else {
        this.debug(escapeControlCharacters(notice.message));
      }
    }
  }

  /**
   * What a change did, as the lines of a result: each file written, updated or
   * removed, and each notice the configuration gave that is not a warning.
   *
   * @param change - The change.
   * @param written - The files it wrote; leave it out for a dry run, which says
   *   what it would remove and writes nothing.
   * @returns The lines, in the order a person reads them.
   */
  protected said(change: Change, written?: readonly string[]): string[] {
    return [
      ...(written ?? []).map((path) => {
        return change.createdPaths.includes(path)
          ? `Wrote ${escapeControlCharacters(path)}`
          : `Updated ${escapeControlCharacters(path)}`;
      }),
      ...change.removedPaths.map((path) => {
        return `${written === undefined ? "Would remove" : "Removed"} ${escapeControlCharacters(path)}`;
      }),
      ...change.notices
        .filter((notice) => {
          return notice.severity !== "warning";
        })
        .map((notice) => {
          return escapeControlCharacters(notice.message);
        }),
    ];
  }

  /**
   * The follow-up commands of a result, as strings when every argument is
   * safe to run as written (the result's `next` commands), and always as
   * argument lists (its `next_args`). The deploy message is a placeholder the
   * caller fills in: quoted in the command string and listed as written in
   * `next_args`.
   *
   * @param changed - Whether a file changed, which `deploy` then publishes.
   * @param leading - Follow-ups that come first, such as publishing a credential
   *   that did not reach the project.
   * @returns The commands and their argument lists.
   */
  protected followUps(changed: boolean, leading: readonly SuggestedCommand[] = []): FollowUps {
    const commands = changed
      ? [
          ...leading,
          this.suggest({
            id: "deploy",
            flags: { dryRun: true },
          }),
          this.suggest({
            id: "deploy",
            flags: { message: WHAT_CHANGED },
          }),
        ]
      : leading;

    return {
      commands,
      args: commands.map((command) => {
        return this.argsOf(command);
      }),
    };
  }

  /**
   * `auth-method password|passkey enable|disable`, as a dry run: says what
   * setting `x-auth-methods.<method>.enabled` on the schema would change. The
   * result carries what the developer typed, so the real run is one command
   * away.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @param method - The method.
   * @param enabled - Whether the method is turned on or off.
   * @returns The dry run's envelope.
   */
  protected async previewToggle(
    target: SchemaTarget,
    change: Change,
    method: ToggleableMethod,
    enabled: boolean,
  ): Promise<CommandResult> {
    const { verb, unchanged, data } = this.toggled(target, change, method, enabled);
    this.report(change);
    const real = await this.realRun();
    const dryRun = dryRunResult({
      verb,
      topic: "auth-method",
      noun: method,
      clause: `for ${target.schema.name}`,
      next: real,
    });

    const title = change.changed
      ? dryRun.summary.title
      : `${escapeControlCharacters(unchanged)} (dry run)`;

    return {
      ...dryRun,
      pretty: undefined,
      data: {
        ...data,
        ...(dryRun.data as object),
        title,
        next_args: [this.argsOf(real)],
      },
      summary: {
        ...dryRun.summary,
        title,
        lines: this.said(change),
      },
    };
  }

  /**
   * `auth-method password|passkey enable|disable`: set
   * `x-auth-methods.<method>.enabled` on one schema. Login flows are never
   * edited, so a change one of them would reject is refused instead.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @param method - The method.
   * @param enabled - Whether the method is turned on or off.
   * @param consent - The consent for a change that removes the schema's last
   *   way to sign in; none for any other.
   * @returns The result.
   * @throws {@link ZitadelError} When the change would leave no way to sign in
   *   and nobody agreed to it.
   */
  protected async applyToggle(
    target: SchemaTarget,
    change: Change,
    method: ToggleableMethod,
    enabled: boolean,
    consent?: Consent,
  ): Promise<CommandResult> {
    const { done, unchanged, data } = this.toggled(target, change, method, enabled);
    const written = await this.write(target, change, consent);
    this.report(change);
    const followUps = this.followUps(change.changed);
    const title = escapeControlCharacters(
      change.changed ? `${done} ${method} for ${target.schema.name}` : unchanged,
    );

    return {
      status: "ok",
      data: {
        ...data,
        title,
        next_args: followUps.args,
      },
      summary: {
        title,
        sections: [],
        lines: this.said(change, written),
      },
      next: { commands: followUps.commands },
    };
  }

  /**
   * The facts a toggle's result states, which a dry run and a real run state
   * alike. Whether the method is offered is judged on the login journey: a
   * passkey that a register step only enrols is not offered to anyone signing
   * in.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @param method - The method.
   * @param enabled - Whether the method is turned on or off.
   * @returns The result's data, and the words the title is made of.
   */
  private toggled(
    target: SchemaTarget,
    change: Change,
    method: ToggleableMethod,
    enabled: boolean,
  ) {
    const schema = target.schema;
    const edited = change.after.schemas.get(schema.path) ?? schema;
    const offered = !enabled || change.after.schemas.listReachableMethods(edited).includes(method);
    const notOffered: readonly ToggleableMethod[] = offered ? [] : [method];

    return {
      verb: enabled ? "enable" : "disable",
      done: enabled ? "Enabled" : "Disabled",
      unchanged: `Nothing to ${enabled ? "enable" : "disable"} for ${schema.name}`,
      data: {
        schema: schema.name,
        file: schema.path,
        method,
        changed: [...change.changedPaths],
        usable: [...edited.usableMethods],
        not_offered: notOffered,
        notices: change.notices,
      },
    };
  }
}

/**
 * What the `auth-method` commands that remove a way to sign in share: the
 * consent a change that leaves the schema none takes, and `--force`, which
 * gives it (ADR 070 §3).
 */
export abstract class AuthMethodDisableCommand extends Destructive(
  AuthMethodCommand,
  "Disable the schema's last way to sign in. Its users can then only be managed through the API.",
) {
  /**
   * Make a change that may leave the schema with no way to sign in, as a dry
   * run: it asks nobody and writes nothing, so there is nothing to confirm,
   * and it shows the change as `--force` would make it. It still refuses where
   * the real run would refuse without asking, so a preview never passes a
   * change that then fails; its re-run keeps `--dry-run`.
   *
   * @param target - What the run read.
   * @param make - Makes the change, with or without `force`.
   * @param naming - The flags that name what the change is to, ahead of the
   *   schema in the re-run it suggests (`--provider`).
   * @returns The change.
   * @throws {@link ZitadelError} With `E_CONFIRMATION_REQUIRED` when nobody can
   *   be asked and `--force` was not given.
   */
  protected async previewIfNoSignInLeft(
    target: SchemaTarget,
    make: (options: ForceOptions) => Change,
    naming: Readonly<{ provider?: string }> = {},
  ): Promise<Change> {
    try {
      return make({
        force: false,
        dryRun: true,
      });
    } catch (error) {
      if (error instanceof ZitadelConfigFlowMethodInUseError) {
        throw refusalError(FLOW_METHOD_IN_USE_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigFlowUncheckedError) {
        throw refusalError(FLOW_UNCHECKED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (!(error instanceof ZitadelConfigEditLockoutError)) {
        throw error;
      }
      if (this.nonInteractive && !this.force) {
        refuseNoSignInLeft((await this.refusalOf(error, target, naming)).refusal);
      }

      return make({
        force: true,
        dryRun: true,
      });
    }
  }

  /**
   * Make a change that may leave the schema with no way to sign in (ADR 070
   * §3).
   *
   * @remarks
   * It is made without `force` first; when the configuration refuses it with
   * {@link ZitadelConfigEditLockoutError}, the person is asked, and a yes makes it again
   * with `force`. `--force` answers for them, and with nobody to ask and no
   * `--force` the run is refused. Either way the change carries the
   * {@link Consent} that answered, which {@link write} requires.
   *
   * @param target - What the run read.
   * @param make - Makes the change, with or without `force`.
   * @param naming - The flags that name what the change is to, ahead of the
   *   schema in the re-run it suggests (`--provider`).
   * @returns The change with the consent that allows it, or `undefined` when
   *   the person said no.
   * @throws {@link ZitadelError} With `E_CONFIRMATION_REQUIRED` when nobody can
   *   be asked and `--force` was not given.
   */
  protected async confirmIfNoSignInLeft(
    target: SchemaTarget,
    make: (options: ForceOptions) => Change,
    naming: Readonly<{ provider?: string }> = {},
  ): Promise<{ change: Change; consent: Consent | undefined } | undefined> {
    try {
      return {
        change: make({
          force: false,
          dryRun: false,
        }),
        consent: undefined,
      };
    } catch (error) {
      if (error instanceof ZitadelConfigFlowMethodInUseError) {
        throw refusalError(FLOW_METHOD_IN_USE_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigFlowUncheckedError) {
        throw refusalError(FLOW_UNCHECKED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (!(error instanceof ZitadelConfigEditLockoutError)) {
        throw error;
      }
      const { question, retry, refusal } = await this.refusalOf(error, target, naming);
      const consent = await this.consent({
        verb: "disable",
        name: `disable ${error.disabling}, the last way to sign in to ${error.schema}`,
        message: question,
        retry,
        refuse: () => {
          return refuseNoSignInLeft(refusal);
        },
      });
      if (consent === undefined) {
        return undefined;
      }

      return {
        change: make({
          force: true,
          dryRun: false,
        }),
        consent: consent,
      };
    }
  }

  /**
   * What a change that leaves the schema no way to sign in is refused with,
   * and the run again that would force it. The re-run is the run again with
   * --force, on the schema it resolved (a dry run's stays a preview, since
   * --force with --dry-run writes nothing), then enabling each method the
   * schema could take instead, then a social sign-in provider.
   *
   * @param error - What the configuration refused it with.
   * @param target - What the run read.
   * @param naming - The flags that name what the change is to, ahead of the
   *   schema in the re-run it suggests (`--provider`).
   * @returns The question, the re-run and the refusal.
   */
  private async refusalOf(
    error: ZitadelConfigEditLockoutError,
    target: SchemaTarget,
    naming: Readonly<{ provider?: string }>,
  ) {
    const question = `Disable ${error.disabling} anyway? Nobody will be able to sign in to ${error.schema}.`;
    const retry = await this.rerun<{
      schema: Interfaces.OptionFlag<string | undefined>;
      force: Interfaces.BooleanFlag<boolean>;
      provider: Interfaces.OptionFlag<string | undefined>;
    }>({
      with: {
        ...naming,
        schema: target.schemaFlag,
        force: true,
      },
    });
    const suggested = [
      retry,
      ...error.alternatives.flatMap((method) => {
        return method === "password" || method === "passkey"
          ? [
              this.suggest({
                id: `auth-method:${method}:enable`,
                flags: { schema: target.schemaFlag },
              }),
            ]
          : [];
      }),
      this.suggest({
        id: "auth-method:sso:enable",
        flags: { provider: "<name>", schema: target.schemaFlag },
      }),
    ];
    const refusal: NoSignInLeftRefusal = {
      error,
      question,
      suggested: {
        commands: suggested,
        args: suggested.map((command) => {
          return this.argsOf(command);
        }),
      },
    };

    return {
      question,
      retry,
      refusal,
    };
  }
}

/**
 * What `auth-method password|passkey enable` share: the method each one turns
 * on, read from {@link MethodEnableCommand.method}, so a command names its
 * method and nothing else.
 */
export abstract class MethodEnableCommand extends AuthMethodCommand {
  /**
   * The method this command turns on.
   */
  protected abstract readonly method: ToggleableMethod;

  /**
   * Says what turning the method on would change, without writing.
   *
   * @param input - The run's flags.
   * @returns The dry run's result.
   */
  protected async preview({ flags }: Admitted<typeof MethodEnableCommand>): Promise<CommandResult> {
    const target = await this.loadSchemaTarget(flags);

    try {
      return await this.previewToggle(
        target,
        target.config.schemas.enable(target.schema, this.method),
        this.method,
        true,
      );
    } catch (error) {
      if (error instanceof ZitadelConfigFlowBrokenError) {
        throw refusalError(FLOW_BROKEN_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigFlowUncheckedError) {
        throw refusalError(FLOW_UNCHECKED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Turns the method on for the schema.
   *
   * @param input - The run's flags.
   * @returns The result.
   */
  protected async apply({ flags }: Admitted<typeof MethodEnableCommand>): Promise<CommandResult> {
    const target = await this.loadSchemaTarget(flags);

    try {
      return await this.applyToggle(
        target,
        target.config.schemas.enable(target.schema, this.method),
        this.method,
        true,
      );
    } catch (error) {
      if (error instanceof ZitadelConfigFlowBrokenError) {
        throw refusalError(FLOW_BROKEN_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigFlowUncheckedError) {
        throw refusalError(FLOW_UNCHECKED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }
}

/**
 * What `auth-method password|passkey disable` share: the method each one turns
 * off, read from {@link MethodDisableCommand.method}, asking before the last
 * way to sign in goes.
 */
export abstract class MethodDisableCommand extends AuthMethodDisableCommand {
  /**
   * The method this command turns off.
   */
  protected abstract readonly method: ToggleableMethod;

  /**
   * Says what turning the method off would change, without writing, refusing
   * where the real run would refuse without asking.
   *
   * @param input - The run's flags.
   * @returns The dry run's result.
   */
  protected async preview({
    flags,
  }: Admitted<typeof MethodDisableCommand>): Promise<CommandResult> {
    const target = await this.loadSchemaTarget(flags);
    const change = await this.previewIfNoSignInLeft(target, (options) => {
      return target.config.schemas.disable(target.schema, this.method, options);
    });

    return this.previewToggle(target, change, this.method, false);
  }

  /**
   * Turns the method off, asking before removing the last way to sign in.
   *
   * @param input - The run's flags.
   * @returns The result.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or the change
   *   would leave no way to sign in and nobody agreed to it.
   */
  protected async apply({ flags }: Admitted<typeof MethodDisableCommand>): Promise<CommandResult> {
    const target = await this.loadSchemaTarget(flags);
    const confirmed = await this.confirmIfNoSignInLeft(target, (options) => {
      return target.config.schemas.disable(target.schema, this.method, options);
    });
    if (confirmed === undefined) {
      return this.cancelled("disable", [
        escapeControlCharacters(
          `${target.schema.path} is unchanged, so ${this.method} is still enabled for ${target.schema.name}.`,
        ),
      ]);
    }

    return this.applyToggle(target, confirmed.change, this.method, false, confirmed.consent);
  }
}
