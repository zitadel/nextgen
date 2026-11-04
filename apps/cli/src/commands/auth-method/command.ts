import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

import {
  hasIdentifier,
  malformedAuthMethods,
  reachableSignInMethods,
  refuseBrokenFlows,
  refuseFlowsUsingMethod,
  refuseUneditable,
  setMethodEnabled,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
  usableSignInMethods,
} from "../../lib/auth-methods";
import { ZitadelError } from "../../lib/errors";
import { servesLogin } from "../../lib/flows";
import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../../lib/idp";
import { stableStringify } from "../../lib/json";
import { optionArgs } from "../../lib/public-cli";
import { reportWarning } from "../../lib/warnings";
import { EnvironmentCommand } from "../../lib/oclif/environment-command";
import { environmentFlags } from "../../lib/oclif/environment-flags";
import { portableSuggestions, type SuggestedCommand } from "../../lib/suggestion";
import { nonBlankString } from "../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import { flowsForSchema } from "../../lib/schema-flows";
import type { JsonEnvelope } from "../../lib/oclif/types";
import { Destructive } from "../../lib/oclif/destructive";
import { Consent } from "../../lib/consent";

/** What every `auth-method` command reads before changing anything. */
export type SchemaTarget = {
  readonly cwd: string;
  readonly cwdArgs: string[];
  readonly schema: SchemaFile;
  readonly flows: FlowFile[];
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
  const schema = selectSchema(await readSchemaFiles(input.cwd), input.schema);
  if (schema.body.kind === "schema-url") {
    throw refusalError(EXTERNAL_SCHEMA_REFUSAL, {
      file: schema.path,
      url: schema.body.url,
    });
  }
  return {
    cwd: input.cwd,
    cwdArgs: input.cwdGiven ? optionArgs("--cwd", input.cwd) : [],
    schema,
    flows: await flowsForSchema(input.cwd, schema),
  };
}

/**
 * What lets a schema change be written: consent when it removes the last way
 * to sign in, `not-the-last-method` when it does not, and `dry-run`, which
 * writes nothing. {@link AuthMethodCommand.writeSchema} checks the claim.
 */
export type Permit = Consent | "not-the-last-method" | "dry-run";

/** The message `deploy` needs, which only the caller can write. */
const DEPLOY_MESSAGE = "<what changed>";

/**
 * What the `auth-method` commands share (ADR 070): finding the schema and its
 * flows, the last-method guard and the refusals in §3, the warnings in §3 and
 * §4, and the result shape. `auth-method password` and `auth-method passkey`
 * are nothing else, so {@link toggle} is all they run.
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
   * The last-method guard (ADR 070 §3). Returns what lets {@link writeSchema}
   * write the change: consent when it removes the last way to sign in, or
   * `undefined` when the user declined, which ends the run as skipped. It
   * refuses without `--force` when nobody can be asked. A change that leaves
   * a way to sign in, or changes nothing, is never asked about.
   *
   * A dry run asks nobody: it changes nothing, so there is nothing to
   * confirm. It still refuses where the real run would refuse without asking
   * (no `--force` and nobody to ask), so a preview never passes a change that
   * then fails; its re-run keeps `--dry-run`. Otherwise {@link reportOutcome} warns that the schema would
   * have no way to sign in left.
   *
   * @param input.disabling - What the prompt names as being disabled: the
   *   method, or the provider for `auth-method sso disable`.
   * @param input.retryArgs - The command's own arguments, which the refusal
   *   suggests again with `--force`.
   */
  protected async lastMethodPermit(input: {
    schema: SchemaFile;
    after: Record<string, unknown>;
    disabling: string;
    retryArgs: string[];
    cwdArgs: string[];
  }): Promise<Permit | undefined> {
    const removesLast = removesLastMethod(input.schema.body, input.after);
    const retryArgs = [...input.retryArgs, ...input.cwdArgs, "--force"];
    // This refusal also lists the methods that could be enabled instead, as
    // argument lists an agent can run whatever the quoting.
    const refuse = (retry = retryArgs) =>
      refuseLastMethod({
        schema: input.schema,
        retryArgs: retry,
        cwdArgs: input.cwdArgs,
        cliVersion: this.cliVersion,
        json: this.isJson,
      });
    if (this.dryRun) {
      if (removesLast && !this.meta.force && this.meta.nonInteractive) {
        // The re-run stays a preview: --force with --dry-run writes nothing.
        refuse([...retryArgs, "--dry-run"]);
      }
      return "dry-run";
    }
    if (!removesLast) {
      return "not-the-last-method";
    }
    return this.consent({
      verb: "disable",
      name: `disable ${input.disabling}, the last way to sign in to ${input.schema.name}`,
      message: `Disable ${input.disabling} anyway? Nobody will be able to sign in to ${input.schema.name}.`,
      retry: portableSuggestions([retryArgs], this.cliVersion)[0],
      refuse: () => refuse(),
    });
  }

  /**
   * Write a changed schema. One that leaves it no way to sign in takes the
   * consent {@link lastMethodPermit} asked for; it checks that itself, so a
   * permit cannot claim a method is kept when the change removes the last.
   */
  protected async writeSchema(
    cwd: string,
    schema: SchemaFile,
    after: Record<string, unknown>,
    permit: Permit,
  ): Promise<void> {
    if (permit === "dry-run") {
      throw new Error(`A dry run tried to write ${schema.path}`);
    }
    if (removesLastMethod(schema.body, after)) {
      Consent.assert(permit);
    }
    await writeFile(join(cwd, schema.path), `${stableStringify(after)}\n`);
  }

  /**
   * Report what the change leaves behind (ADR 070 §3 and §4). Called once the
   * change is previewed or written, never before: a failed write must not
   * claim it.
   *
   * @param input.flowsAfter - The flows as the change leaves them, whatever
   *   their status.
   * @param input.notOffered - Methods the run enabled that no flow offers,
   *   and the schema's flow files, which the warning names.
   */
  protected reportOutcome(input: {
    schema: SchemaFile;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    flowsAfter: readonly Record<string, unknown>[];
    notOffered?: { methods: readonly ToggleableMethod[]; flows: readonly FlowFile[] };
  }): void {
    const { methods = [], flows = [] } = input.notOffered ?? {};
    for (const method of methods) {
      // Enabling first and editing the flow second is a normal order of work.
      reportWarning(
        `No login flow for ${input.schema.name} offers ${method} yet. ${howToOffer(input.schema, method, flows)}`,
      );
    }
    if (removesLastMethod(input.before, input.after)) {
      // Reached only through --force, a confirmed prompt or a dry run: said
      // even so.
      reportWarning(
        `${input.schema.name} ${this.dryRun ? "would have" : "has"} no way to sign in left. ` +
          "Its users can only be managed through the API.",
      );
      return;
    }
    // A schema that enables nothing has nothing for a flow to offer; that is
    // the API-only case the last-method guard already let through.
    if (
      usableSignInMethods(input.after).length > 0 &&
      reachableSignInMethods(input.after, input.flowsAfter).length === 0
    ) {
      // The schema still enables something, but no active flow offers it.
      // Flows are not these commands' to rewrite (ADR 070 §2), so it is said.
      reportWarning(
        `No active login flow for ${input.schema.name} offers a method it enables, ` +
          "so nobody can sign in until one does.",
      );
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
    const args = [
      ...leading,
      ...(changed
        ? [
            ["deploy", "--dry-run", ...cwdArgs],
            ["deploy", "-m", DEPLOY_MESSAGE, ...cwdArgs],
          ]
        : []),
    ];
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
    const { cwd, cwdArgs, schema, flows } = target;
    const verb = enabled ? "enable" : "disable";

    refuseUneditable(schema.path, malformedAuthMethods(schema.body, method));
    const change = setMethodEnabled(schema.body, method, enabled);
    if (change.changed) {
      if (enabled) {
        refuseMissingIdentifier(schema, method);
      }
      // Both directions: a changed schema re-pins its flows, so `deploy` would
      // reject one it cannot check either way. Before the last-method guard,
      // because these refusals have no override, and nobody should be asked
      // to confirm a change that fails anyway.
      if (enabled) {
        refuseBrokenFlows(
          schema,
          change.document,
          flows.map((file) => ({ file, after: file.body })),
        );
      } else {
        refuseFlowsUsingMethod(schema, change.document, flows, method);
      }
    }
    const permit = await this.lastMethodPermit({
      schema,
      after: change.document,
      disabling: method,
      retryArgs: ["auth-method", method, "disable", ...optionArgs("--schema", schema.schemaFlag)],
      cwdArgs,
    });
    if (permit === undefined) {
      return this.emit({ status: "skipped", reason: "disable-cancelled" });
    }

    const flowsAfter = flows.map((file) => file.body);
    // Judged on the login journey, as the reachability warning is: a passkey
    // that a register step only enrols is not offered to anyone signing in.
    const notOffered =
      enabled && !reachableSignInMethods(change.document, flowsAfter).includes(method)
        ? [method]
        : [];
    const data = {
      schema: schema.name,
      file: schema.path,
      method,
      changed: change.changed ? [schema.path] : [],
      usable: usableSignInMethods(change.document),
      not_offered: notOffered,
    };
    const outcome = {
      schema,
      before: schema.body,
      after: change.document,
      flowsAfter,
      notOffered: { methods: notOffered, flows },
    };

    if (this.dryRun) {
      this.reportOutcome(outcome);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty: change.changed
          ? `Would ${verb} ${method} for ${schema.name}`
          : `Nothing to ${verb} for ${schema.name}`,
      });
    }
    if (change.changed) {
      await this.writeSchema(cwd, schema, change.document, permit);
      consola.success(`Updated ${schema.path}`);
    } else {
      consola.info(`${method} is already ${verb}d for ${schema.name}`);
    }
    this.reportOutcome(outcome);
    const followUps = this.followUps(change.changed, cwdArgs);
    return this.emit({
      status: "ok",
      data: { ...data, next_args: followUps.args },
      next: { commands: followUps.commands },
      pretty: change.changed
        ? `${enabled ? "Enabled" : "Disabled"} ${method} for ${schema.name}`
        : `Nothing to ${verb} for ${schema.name}`,
    });
  }
}

/**
 * What to add so a login flow offers a method the schema enables, naming the
 * active login flows it could go in. Only steps reached from `purposes.login`
 * count, as {@link reachableSignInMethods} judges it.
 */
function howToOffer(
  schema: SchemaFile,
  method: ToggleableMethod,
  flows: readonly FlowFile[],
): string {
  const paths = flows.filter((file) => servesLogin(file.body)).map((file) => file.path);
  const where =
    paths.length > 0
      ? paths.join(" or ")
      : `an active login flow for ${schema.name} in .zitadel/flows/`;
  const how =
    method === "password"
      ? `add "x-auth-methods#password" to the fields of a step reached from purposes.login, with a "kind": "submit" action and a transition under its name.`
      : `add a "kind": "passkey" action to a step reached from purposes.login, plus a transition under the action's name. ` +
        'A "kind": "passkey_register" action does the same for sign-up.';
  return `In ${where}, ${how} See .zitadel/flows/README.md.`;
}

/** The server refuses password on a schema without an identifier. */
function refuseMissingIdentifier(schema: SchemaFile, method: ToggleableMethod): void {
  if (method !== "password" || hasIdentifier(schema.body)) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${schema.path} has no x-identifier for password`, {
    hint:
      "A password is checked against the user found by the schema's identifier. " +
      'Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
    details: { file: schema.path, method: "password" },
  });
}

/** Whether a change takes the schema from some way to sign in to none. */
function removesLastMethod(before: Record<string, unknown>, after: Record<string, unknown>) {
  return usableSignInMethods(before).length > 0 && usableSignInMethods(after).length === 0;
}

/**
 * Refuse removing the last way in without --force. The exact re-run comes
 * first. The alternatives are the methods the schema does not enable, which
 * leaves out the one being turned off, and password only where the schema can
 * take it (it needs an identifier). Only `--json` names `details.suggested_args`:
 * a person reads the same commands under Next.
 */
function refuseLastMethod(input: {
  schema: SchemaFile;
  retryArgs: string[];
  cwdArgs: string[];
  cliVersion: string;
  json: boolean;
}): never {
  const { schema } = input;
  const enabled = usableSignInMethods(schema.body);
  const alternatives = TOGGLEABLE_METHODS.filter(
    (method) => !enabled.includes(method) && (method !== "password" || hasIdentifier(schema.body)),
  );
  // Every suggestion as an argument list, the re-run first. The schema name
  // comes from a file name and the --cwd path from the user; one that would
  // need quoting leaves the strings out, because quoting differs between POSIX
  // shells, PowerShell and cmd.exe and none is safe on all of them.
  const suggestedArgs = [
    input.retryArgs,
    ...alternatives.map((method) => [
      "auth-method",
      method,
      "enable",
      ...optionArgs("--schema", schema.schemaFlag),
      ...input.cwdArgs,
    ]),
  ];
  throw new ZitadelError("E_VALIDATION", `${schema.path} would have no way to sign in left`, {
    hint:
      "Enable another method first, such as `zitadel auth-method sso enable --provider <name>`. " +
      "If the schema's users are only managed through the API, re-run with --force" +
      (input.json ? " (the first of details.suggested_args holds the exact arguments)." : "."),
    details: {
      file: schema.path,
      usable: enabled,
      suggested_args: suggestedArgs,
    },
    nextCommands: portableSuggestions(suggestedArgs, input.cliVersion),
  });
}
