import { Consent } from "@/lib/consent";
import { CANCELLED, ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import { Destructive } from "@/lib/oclif/destructive";
import { EnvironmentCommand } from "@/lib/oclif/environment-command";
import { environmentFlags } from "@/lib/oclif/environment-flags";
import { nonBlankString } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import type { JsonEnvelope } from "@/lib/oclif/types";
import { optionArgs } from "@/lib/public-cli";
import {
  type SuggestedCommand,
  type SuggestRest,
  suggestion,
  WHAT_CHANGED,
} from "@/lib/suggestion";
import { publishedIds } from "@/lib/sync/state";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import {
  AmbiguousSchemaError,
  type BrokenFile,
  BrokenFilesError,
  type Change,
  CONFIG_DIRECTORIES,
  type ConfigStore,
  DiskStore,
  type ForceOptions,
  NoSignInLeftError,
  SchemaNotFoundError,
  type Schemas,
  type ToggleableMethod,
  type UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";

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
 * A change made on a schema, with the consent that let it leave the schema no
 * way to sign in, which {@link AuthMethodCommand.write} checks.
 */
export type ConfirmedChange = {
  /**
   * The change.
   */
  readonly change: Change;

  /**
   * The consent {@link AuthMethodCommand.confirmIfNoSignInLeft} asked for, or
   * `undefined` when the change does not need one: it keeps a way to sign in,
   * or the run is a dry run, which writes nothing.
   */
  readonly consent: Consent | undefined;
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
 * What {@link readSchemaTarget} reads the schema by.
 */
export type SchemaTargetInput = {
  /**
   * The run's directory.
   */
  readonly cwd: string;

  /**
   * What `--schema` named, if anything.
   */
  readonly schema: string | undefined;
};

/**
 * What a schema pointing at an external URL is refused for.
 */
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
 * What a Project with no user schema at all is refused for.
 */
const NO_SCHEMA_REFUSAL: Refusal = {
  code: "E_NOT_FOUND",
  message: "This project has no user schema under .zitadel/schemas",
  hint: "Set the project up first.",
  next: [suggestion("setup")],
};

/**
 * What a `--schema` that names no schema is refused for.
 */
const UNKNOWN_SCHEMA_REFUSAL: Refusal = {
  code: "E_NOT_FOUND",
  message: "This project has no user schema named {requested}",
  hint: "Known schemas: {labels}",
  details: {
    requested: "{requested}",
    known: "{known}",
    schemas: "{schemas}",
  },
};

/**
 * What a run that names no schema, where there are several, is refused for.
 */
const UNNAMED_SCHEMA_REFUSAL: Refusal = {
  message: "This project has more than one user schema",
  hint: "Name the one to change with --schema. Known schemas: {labels}",
  details: {
    known: "{known}",
    schemas: "{schemas}",
  },
};

/**
 * What a `--schema` that more than one schema answers to is refused for.
 */
const AMBIGUOUS_SCHEMA_REFUSAL: Refusal = {
  message: "More than one user schema is named {requested}: {labels}",
  hint: "Name the one to change by its file: {flags}",
  details: {
    requested: "{requested}",
    candidates: "{candidates}",
    schemas: "{schemas}",
  },
};

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
 * first, so its refusals come before the state is read. Every file is held to
 * its contract, so a broken file is refused rather than left out of what the
 * run edits.
 *
 * @param input - The run's directory and what `--schema` named.
 * @returns What the run read.
 * @throws {@link ZitadelError} When no schema, or more than one, fits
 *   `--schema`, or the one that does points at an external schema.
 * @throws {@link BrokenFilesError} Naming every file the contract rules refuse.
 */
export async function readSchemaTarget(input: SchemaTargetInput): Promise<SchemaTarget> {
  const store = new DiskStore(input.cwd);
  // The schema is chosen from the files alone, so a refusal about the schema
  // comes before anything else, the state file included.
  const loaded = await ZitadelConfig.loadUnchecked(store);
  const schema = chosenOrBroken(loaded, input.schema);
  if (schema.isExternal) {
    throw refusalError(EXTERNAL_SCHEMA_REFUSAL, {
      file: schema.path,
      url: String(schema.body.url),
    });
  }
  // Only the chosen schema's ids are read, so an entry the state holds for
  // another schema is no concern of this run. The files are read once, and the
  // schema chosen from them stands: the ids only matter to the flows.
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
 * The schema a run is about, from a configuration no file of which has been
 * held to its contract yet.
 *
 * @remarks
 * A broken schema file is no schema, so a Project whose only (or named)
 * schema is broken would be told it has none. When no schema can be chosen
 * because the file that would have been is broken, the broken file is what the
 * person has to fix, so that is what is refused. Any other way of failing to
 * choose, such as several valid schemas and none named, is refused as it is,
 * whatever else is broken: the broken file is reported once a schema is chosen.
 *
 * @param config - The configuration, read without refusing a broken file.
 * @param requested - What `--schema` named, if anything.
 * @returns The chosen schema.
 * @throws {@link BrokenFilesError} Naming the broken schema file the run
 *   would have chosen.
 * @throws {@link ZitadelError} When no schema, or more than one, fits
 *   `--schema` and no broken schema file is the one it asks for.
 */
function chosenOrBroken(config: ZitadelConfig, requested: string | undefined): UserSchema {
  try {
    config.schemas.resolve(requested);
  } catch (error) {
    if (error instanceof SchemaNotFoundError) {
      const broken = brokenCandidates(config, requested);
      if (broken.length > 0) {
        throw new BrokenFilesError(
          broken.flatMap((file) => {
            return file.problems;
          }),
        );
      }
    }
  }
  return chosenSchema(config.schemas, requested);
}

/**
 * The broken schema files that would have been chosen, had they not been
 * broken.
 *
 * @param config - The configuration, read without refusing a broken file.
 * @param requested - What `--schema` named, if anything.
 * @returns With no `--schema`, every broken schema file, since none is valid;
 *   with one, those named by it; none when a valid schema exists to choose
 *   from, or no broken file fits.
 */
function brokenCandidates(
  config: ZitadelConfig,
  requested: string | undefined,
): readonly BrokenFile[] {
  const broken = config.broken.filter((file) => {
    return file.kind === "schema";
  });
  if (requested === undefined) {
    return broken;
  }
  const name = requested.endsWith(".json") ? requested.slice(0, -".json".length) : requested;
  return broken.filter((file) => {
    return file.path === `${CONFIG_DIRECTORIES.schemas}/${name}.json`;
  });
}

/**
 * One follow-up, as the command to run and as the words after the CLI
 * (`next_args`), both made from the same typed input.
 */
export type Follow = {
  /**
   * The command, rendered for the run.
   */
  readonly command: SuggestedCommand;

  /**
   * The same command as its words, unquoted.
   */
  readonly args: readonly string[];
};

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
    ...HIDDEN_ENVIRONMENT_FLAGS,
    schema: nonBlankString({
      description:
        "User schema to change, by file name or objectType. Required when the project has more than one.",
    }),
  };

  static override meta = {
    resolveServer: false,
    environment: false,
  };

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
   * A follow-up as a command and as its words, both from the same typed input.
   *
   * @param id - The target, as oclif names it.
   * @param rest - Its arguments and flags, by the names code reads them.
   * @returns The command and its words.
   */
  protected follow<const Id extends string>(id: Id, ...rest: SuggestRest<Id>): Follow {
    return {
      command: this.suggest(id, ...rest),
      args: this.suggestArgs(id, ...rest),
    };
  }

  /**
   * Make a change that may leave the schema with no way to sign in (ADR 070
   * §3).
   *
   * @remarks
   * It is made without `force` first; when the configuration refuses it with
   * {@link NoSignInLeftError}, the person is asked, and a yes makes it again
   * with `force`. `--force` answers for them, and with nobody to ask and no
   * `--force` the run is refused. Either way the change carries the
   * {@link Consent} that answered, which {@link write} requires.
   *
   * A dry run asks nobody: it writes nothing, so there is nothing to confirm,
   * and it shows the change as `--force` would make it. It still refuses where
   * the real run would refuse without asking, so a preview never passes a
   * change that then fails; its re-run keeps `--dry-run`.
   *
   * @param target - What the run read.
   * @param retry - The command again with `--force`, which a refusal suggests,
   *   as a real run and as a dry run.
   * @param make - Makes the change, with or without `force`.
   * @returns The change with the consent that allows it, or `undefined` when
   *   the person said no.
   * @throws {@link ZitadelError} With `E_CONFIRMATION_REQUIRED` when nobody can
   *   be asked and `--force` was not given.
   */
  protected async confirmIfNoSignInLeft(
    target: SchemaTarget,
    retry: Readonly<{ real: Follow; dryRun: Follow }>,
    make: (options: ForceOptions) => Change,
  ): Promise<ConfirmedChange | undefined> {
    try {
      return {
        change: make({
          force: false,
          dryRun: this.dryRun,
        }),
        consent: undefined,
      };
    } catch (error) {
      if (!(error instanceof NoSignInLeftError)) {
        throw error;
      }
      const question = `Disable ${error.disabling} anyway? Nobody will be able to sign in to ${error.schema}.`;
      if (this.dryRun && this.nonInteractive && !this.force) {
        // The re-run stays a preview: --force with --dry-run writes nothing.
        refuseNoSignInLeft({
          target,
          error,
          question,
          retry: retry.dryRun,
          alternatives: this.alternativesOf(target, error),
          json: this.isJson,
        });
      }
      if (this.dryRun) {
        return {
          change: make({
            force: true,
            dryRun: true,
          }),
          consent: undefined,
        };
      }
      const consent = await this.consent({
        verb: "disable",
        name: `disable ${error.disabling}, the last way to sign in to ${error.schema}`,
        message: question,
        retry: retry.real.command,
        refuse: () => {
          return refuseNoSignInLeft({
            target,
            error,
            question,
            retry: retry.real,
            alternatives: this.alternativesOf(target, error),
            json: this.isJson,
          });
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
   * Enabling each method the schema could take instead, as follow-ups.
   *
   * @param target - What the run read.
   * @param error - The refusal that lists them.
   * @returns One follow-up per alternative.
   */
  private alternativesOf(target: SchemaTarget, error: NoSignInLeftError): readonly Follow[] {
    return error.alternatives.flatMap((method) => {
      if (method !== "password" && method !== "passkey") {
        return [];
      }

      return [
        this.follow(`auth-method:${method}:enable`, {
          flags: target.schemaFlag === undefined ? {} : { schema: target.schemaFlag },
        }),
      ];
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
    const written = await change.save(target.store);
    for (const path of written) {
      if (change.createdPaths.includes(path)) {
        log.done(`Wrote ${escapeControlCharacters(path)}`);
      } else {
        log.done(`Updated ${escapeControlCharacters(path)}`);
      }
    }
    for (const path of change.removedPaths) {
      log.done(`Removed ${escapeControlCharacters(path)}`);
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
        reportWarning(notice.message);
      } else {
        log.info(escapeControlCharacters(notice.message));
      }
    }
  }

  /**
   * The follow-up commands of a result, as strings when every argument is
   * safe to run as written (the result's `next` commands), and always as
   * argument lists (its `next_args`).
   *
   * @param changed - Whether a file changed, which `deploy` then publishes.
   * @param leading - Follow-ups that come first, such as publishing a credential
   *   that did not reach the project.
   * @returns The commands and their argument lists.
   */
  protected followUps(changed: boolean, leading: readonly Follow[] = []): FollowUps {
    // The message is a placeholder the caller fills in: quoted in the command
    // string and listed as written in `next_args`.
    const follows = changed
      ? [
          ...leading,
          this.follow("deploy", { flags: { dryRun: true } }),
          this.follow("deploy", { flags: { message: WHAT_CHANGED } }),
        ]
      : leading;

    return {
      commands: follows.map((follow) => {
        return follow.command;
      }),
      args: follows.map((follow) => {
        return follow.args;
      }),
    };
  }

  /**
   * `auth-method password|passkey enable|disable`: set
   * `x-auth-methods.<method>.enabled` on one schema. Login flows are never
   * edited, so a change one of them would reject is refused instead.
   *
   * @remarks
   * Reads as every `auth-method` command does: load the schema, make the
   * change, confirm it, preview or save it, report what the configuration
   * said, and emit the result.
   *
   * @param flags - The run's `--schema` and `--cwd`.
   * @param method - The method.
   * @param enabled - Whether the method is turned on or off.
   * @returns The result.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or the change
   *   would leave no way to sign in and nobody agreed to it.
   */
  protected async toggle(
    flags: SchemaFlags,
    method: ToggleableMethod,
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    const target = await this.loadSchemaTarget(flags);
    const config = target.config;
    const schema = target.schema;
    const forced = { schema: target.schemaFlag, force: true } as const;
    const confirmed = await this.confirmIfNoSignInLeft(
      target,
      {
        real: this.follow(`auth-method:${method}:disable`, { flags: forced }),
        dryRun: this.follow(`auth-method:${method}:disable`, {
          flags: { ...forced, dryRun: true },
        }),
      },
      (options) => {
        if (enabled) {
          return config.schemas.enable(schema, method);
        }
        return config.schemas.disable(schema, method, options);
      },
    );
    if (confirmed === undefined) {
      return this.emit({
        status: "skipped",
        reason: "disable-cancelled",
        summary: {
          title: CANCELLED,
          sections: [],
          lines: [
            escapeControlCharacters(
              `${schema.path} is unchanged, so ${method} is still enabled for ${schema.name}.`,
            ),
          ],
        },
      });
    }
    const change = confirmed.change;

    const verb = enabled ? "enable" : "disable";
    const done = enabled ? "Enabled" : "Disabled";
    const edited = change.after.schemas.get(schema.path) ?? schema;
    // Judged on the login journey: a passkey that a register step only
    // enrols is not offered to anyone signing in.
    const offered = !enabled || change.after.schemas.listReachableMethods(edited).includes(method);
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
      const wouldTitle = escapeControlCharacters(
        change.changed
          ? `Would ${verb} ${method} for ${schema.name} (dry run)`
          : `${unchanged} (dry run)`,
      );
      const schemaGiven = target.schemaGiven === undefined ? {} : { schema: target.schemaGiven };
      const real = enabled
        ? this.follow(`auth-method:${method}:enable`, { flags: schemaGiven })
        : this.follow(`auth-method:${method}:disable`, {
            flags: { ...schemaGiven, ...(this.force ? { force: true } : {}) },
          });

      return this.emit({
        status: "ok",
        data: {
          ...data,
          title: wouldTitle,
          dry_run: true,
          next_args: [real.args],
        },
        summary: {
          title: wouldTitle,
          sections: [],
        },
        next: { commands: [real.command] },
      });
    }
    await this.write(target, change, confirmed.consent);
    this.report(change);
    const followUps = this.followUps(change.changed);
    const title = escapeControlCharacters(
      change.changed ? `${done} ${method} for ${schema.name}` : unchanged,
    );

    return this.emit({
      status: "ok",
      data: {
        ...data,
        title,
        next_args: followUps.args,
      },
      summary: {
        title,
        sections: [],
      },
      next: { commands: followUps.commands },
    });
  }
}

/**
 * What {@link refuseNoSignInLeft} words its refusal from.
 */
type NoSignInLeftRefusal = {
  readonly target: SchemaTarget;
  readonly error: NoSignInLeftError;
  readonly question: string;
  readonly retry: Follow;
  readonly alternatives: readonly Follow[];
  readonly json: boolean;
};

/**
 * Refuse leaving a schema with no way to sign in, without --force.
 *
 * @remarks
 * The exact re-run comes first, then enabling each method the schema could
 * take instead. Only `--json` names `details.suggested_args`: a person reads
 * the same commands under Next.
 *
 * @param input - The run, the refusal, the question a person would be asked,
 *   and the re-run.
 * @throws {@link ZitadelError} With `E_CONFIRMATION_REQUIRED`, always.
 */
function refuseNoSignInLeft(input: NoSignInLeftRefusal): never {
  const error = input.error;
  // Every suggestion as an argument list, the re-run first. The commands quote
  // what needs it and the lists carry the words as they are.
  const follows = [input.retry, ...input.alternatives];
  const suggestedArgs = follows.map((follow) => {
    return follow.args;
  });
  const where = input.json
    ? " (the first of details.suggested_args holds the exact arguments)."
    : ".";
  // Its --force retry is a consent only a person may give, as every gate's is.
  throw new ZitadelError("E_CONFIRMATION_REQUIRED", error.message, {
    hint: `Enable another method first, such as \`zitadel auth-method sso enable --provider '<name>'\`. If the schema's users are only managed through the API, ask a person first: ${input.question} Re-run with --force only once they agree${where}`,
    details: {
      question: input.question,
      file: error.path,
      usable: error.usable,
      suggested_args: suggestedArgs,
    },
    nextCommands: follows.map((follow) => {
      return follow.command;
    }),
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
 * A schema as a refusal lists it for a script.
 */
type SchemaDetail = {
  readonly name: string;
  readonly object_type: string | null;
};

/**
 * The schemas a refusal names, for a script: each file name with its `objectType`.
 *
 * @param schemas - The schemas.
 * @returns Their names.
 */
function detailsOf(schemas: readonly UserSchema[]): readonly SchemaDetail[] {
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
    if (error instanceof SchemaNotFoundError && error.known.length === 0) {
      throw refusalError(NO_SCHEMA_REFUSAL, {});
    }
    if (error instanceof SchemaNotFoundError) {
      throw refusalError(UNKNOWN_SCHEMA_REFUSAL, {
        requested: error.requested,
        labels: error.known.map(labelOf).join(", "),
        known: namesOf(error.known),
        schemas: detailsOf(error.known),
      });
    }
    if (error instanceof AmbiguousSchemaError && error.requested === undefined) {
      throw refusalError(UNNAMED_SCHEMA_REFUSAL, {
        labels: error.candidates.map(labelOf).join(", "),
        known: namesOf(error.candidates),
        schemas: detailsOf(error.candidates),
      });
    }
    if (error instanceof AmbiguousSchemaError) {
      const flags = error.candidates.map((schema) => {
        return optionArgs("--schema", schemas.nameUniquely(schema)).join(" ");
      });
      throw refusalError(AMBIGUOUS_SCHEMA_REFUSAL, {
        requested: error.requested,
        labels: error.candidates.map(labelOf).join(", "),
        flags: flags.join(" or "),
        candidates: namesOf(error.candidates),
        schemas: detailsOf(error.candidates),
      });
    }
    throw error;
  }
}
