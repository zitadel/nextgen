import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cancel, confirm, isCancel } from "@clack/prompts";
import { consola } from "consola";

import {
  hasIdentifier,
  malformedAuthMethods,
  reachableSignInMethods,
  refuseBrokenFlows,
  refuseUneditable,
  setMethodEnabled,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
  usableSignInMethods,
} from "../auth-methods";
import { ZitadelError } from "../errors";
import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../idp";
import { stableStringify } from "../json";
import { optionArgs, portableCommands } from "../public-cli";
import { flowsForSchema } from "../schema-flows";
import { reportWarning } from "../warnings";
import { BaseCommand } from "./base";
import { nonBlankString } from "./flags";
import type { JsonEnvelope } from "./types";

/** What every `auth-method` command reads before changing anything. */
type Target = {
  readonly cwd: string;
  /** `--cwd` for a follow-up command, or none when the run had none. */
  readonly cwdArgs: string[];
  readonly schema: SchemaFile;
  /** The login flows that run against the schema, whatever their status. */
  readonly flows: FlowFile[];
};

/**
 * What the `auth-method` commands share (ADR 069): finding the schema and its
 * flows, the last-method guard and the refusals in §3, the warnings in §3 and
 * §4, and the result shape. `auth-method password` and `auth-method passkey`
 * are nothing else, so {@link toggle} is all they run.
 *
 * Only `auth-method sso enable` talks to a server, to store the provider's
 * credentials. Every other edit is local, and `plan` and `apply` publish it
 * like any configuration change.
 */
export abstract class AuthMethodCommand extends BaseCommand {
  static override baseFlags = {
    ...BaseCommand.baseFlags,
    schema: nonBlankString({
      description: "User schema to change. Required when the Project has more than one.",
    }),
  };

  /**
   * Set up the invocation, then read the schema and the flows that run
   * against it, refusing a schema whose methods live elsewhere.
   *
   * @param flags - The parsed flags.
   * @param options.resolveServer - Whether the command talks to a server.
   *   Off by default: a stopped local runtime must not block staging a change
   *   for a later `apply`.
   * @param options.preflight - Checks that must answer before the schema is
   *   read, with whatever they read handed back as `preflight`.
   */
  protected async target<T = undefined>(
    flags: { schema?: string; cwd?: string },
    options: { resolveServer?: boolean; preflight?: (cwd: string) => Promise<T> } = {},
  ): Promise<Target & { readonly preflight: T }> {
    await this.toMeta(flags, { resolveServer: options.resolveServer ?? false });
    const { cwd } = this.meta;
    const preflight = (await options.preflight?.(cwd)) as T;
    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    refuseExternalSchema(schema);
    return {
      cwd,
      // A follow-up run from where the user stands must reach the same Project.
      cwdArgs: flags.cwd === undefined ? [] : optionArgs("--cwd", cwd),
      schema,
      flows: await flowsForSchema(cwd, schema),
      preflight,
    };
  }

  /**
   * The last-method guard (ADR 069 §3). Returns `false` when the user declined
   * the prompt, which ends the run as skipped; refuses without `--force` when
   * nobody can be asked.
   *
   * A dry run passes, as it does `variables delete`'s guard: it changes
   * nothing, so there is nothing to confirm, and {@link reportOutcome} still
   * warns that the schema would have no way to sign in left.
   *
   * @param input.disabling - What the prompt names as being disabled: the
   *   method, or the provider for `auth-method sso disable`.
   * @param input.retryArgs - The command's own arguments, which the refusal
   *   suggests again with `--force`.
   */
  protected async confirmLastMethod(input: {
    schema: SchemaFile;
    after: Record<string, unknown>;
    disabling: string;
    retryArgs: string[];
    cwdArgs: string[];
  }): Promise<boolean> {
    const { dryRun, force, nonInteractive, cliVersion } = this.meta;
    if (dryRun || force || !removesLastMethod(input.schema.body, input.after)) {
      return true;
    }
    if (nonInteractive) {
      refuseLastMethod({
        schema: input.schema,
        retryArgs: [...input.retryArgs, ...input.cwdArgs, "--force"],
        cwdArgs: input.cwdArgs,
        cliVersion,
      });
    }
    const answer = await confirm({
      message: `Disable ${input.disabling} anyway? Nobody will be able to sign in to ${input.schema.name}.`,
      initialValue: false,
    });
    if (isCancel(answer) || !answer) {
      cancel("Disable cancelled.");
      return false;
    }
    return true;
  }

  /**
   * Report what the change leaves behind (ADR 069 §3 and §4). Called once the
   * change is previewed or written, never before: a failed write must not
   * claim it.
   *
   * @param input.flowsAfter - The flows as the change leaves them, whatever
   *   their status.
   * @param input.notOffered - Methods the run enabled that no flow offers.
   */
  protected reportOutcome(input: {
    schema: SchemaFile;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    flowsAfter: readonly Record<string, unknown>[];
    notOffered?: readonly string[];
  }): void {
    const { dryRun } = this.meta;
    for (const method of input.notOffered ?? []) {
      // Enabling first and editing the flow second is a normal order of work.
      reportWarning(
        `No login flow for ${input.schema.name} offers ${method} yet. Add it to a flow to show it.`,
      );
    }
    if (removesLastMethod(input.before, input.after)) {
      // Reached only through --force, a confirmed prompt or a dry run: said
      // even so.
      reportWarning(
        `${input.schema.name} ${dryRun ? "would have" : "has"} no way to sign in left. ` +
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
      // Flows are not these commands' to rewrite (ADR 069 §2), so it is said.
      reportWarning(
        `No active login flow for ${input.schema.name} offers a method it enables, ` +
          "so nobody can sign in until one does.",
      );
    }
  }

  /**
   * The follow-up commands of a result, as strings when every argument is
   * safe to run as written, and always as argument lists.
   *
   * @param changed - Whether a file changed, which `plan` and `apply` then
   *   publish.
   * @param cwdArgs - `--cwd` for `plan` and `apply`, from {@link target}.
   * @param leading - Commands that come first, such as publishing a credential
   *   that did not reach the project.
   */
  protected followUps(
    changed: boolean,
    cwdArgs: string[],
    leading: string[][] = [],
  ): { next_commands: string[]; next_args: string[][] } {
    const args = [
      ...leading,
      ...(changed
        ? [
            ["plan", ...cwdArgs],
            ["apply", ...cwdArgs],
          ]
        : []),
    ];
    return { next_commands: portableCommands(args, this.meta.cliVersion), next_args: args };
  }

  /**
   * `auth-method password|passkey enable|disable`: set
   * `x-auth-methods.<method>.enabled` on one schema. Login flows are never
   * edited, so a change one of them would reject is refused instead.
   */
  protected async toggle(
    flags: { schema?: string; cwd?: string },
    method: ToggleableMethod,
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    const { cwd, cwdArgs, schema, flows } = await this.target(flags);
    const { dryRun } = this.meta;
    const verb = enabled ? "enable" : "disable";

    refuseUneditable(schema.path, malformedAuthMethods(schema.body, method));
    const change = setMethodEnabled(schema.body, method, enabled);
    if (change.changed) {
      if (enabled) {
        refuseMissingIdentifier(schema, method);
      }
      // Both directions: a changed schema re-pins its flows, so `plan` would
      // reject one it cannot check either way. Before the last-method guard,
      // because these refusals have no override, and nobody should be asked
      // to confirm a change that fails anyway.
      refuseBrokenFlows(
        schema,
        change.document,
        flows.map((file) => ({ file, after: file.body })),
        enabled
          ? undefined
          : {
              heading: `A login flow still uses what ${schema.path} would disable:`,
              hint:
                "Remove the method from those steps first, then run the command again. " +
                "Login flows are not edited for you.",
            },
      );
      const proceed = await this.confirmLastMethod({
        schema,
        after: change.document,
        disabling: method,
        retryArgs: ["auth-method", method, "disable", ...optionArgs("--schema", schema.name)],
        cwdArgs,
      });
      if (!proceed) {
        return this.emit({ status: "skipped", reason: "disable-cancelled" });
      }
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
      notOffered,
    };

    if (dryRun) {
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
      await writeFile(join(cwd, schema.path), `${stableStringify(change.document)}\n`);
      consola.success(`Updated ${schema.path}`);
    } else {
      consola.info(`${method} is already ${verb}d for ${schema.name}`);
    }
    this.reportOutcome(outcome);
    return this.emit({
      status: "ok",
      data: { ...data, ...this.followUps(change.changed, cwdArgs) },
      pretty: change.changed
        ? `${enabled ? "Enabled" : "Disabled"} ${method} for ${schema.name}`
        : `Nothing to ${verb} for ${schema.name}`,
    });
  }
}

/**
 * A schema that points at an external URL holds no sign-in methods of its own:
 * they live in the schema the server fetches, so editing the pointer would
 * change nothing.
 */
function refuseExternalSchema(schema: SchemaFile): void {
  if (schema.body.kind !== "schema-url") {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${schema.path} points at an external schema`, {
    hint:
      "Its sign-in methods live in the schema at its url, which the server fetches. " +
      "Edit x-auth-methods there instead.",
    details: { file: schema.path, url: schema.body.url },
  });
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
 * take it (it needs an identifier).
 */
function refuseLastMethod(input: {
  schema: SchemaFile;
  retryArgs: string[];
  cwdArgs: string[];
  cliVersion: string;
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
      ...optionArgs("--schema", schema.name),
      ...input.cwdArgs,
    ]),
  ];
  throw new ZitadelError("E_VALIDATION", `${schema.path} would have no way to sign in left`, {
    hint:
      "Enable another method first, such as `zitadel auth-method sso enable --provider <name>`. " +
      "If the schema's users are only managed through the API, re-run with --force " +
      "(the first of details.suggested_args holds the exact arguments).",
    details: {
      file: schema.path,
      usable: enabled,
      suggested_args: suggestedArgs,
    },
    nextCommands: portableCommands(suggestedArgs, input.cliVersion),
  });
}
