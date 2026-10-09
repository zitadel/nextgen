import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cancel, confirm, isCancel } from "@clack/prompts";
import { Flags } from "@oclif/core";
import type { FlowValidationIssue } from "@zitadel/config/validate";
import { consola } from "consola";

import {
  AUTH_FACTORS,
  type AuthFactor,
  checkFlow,
  hasIdentifier,
  malformedAuthMethods,
  reachableSignInMethods,
  setAuthFactors,
  usableSignInMethods,
} from "../../lib/auth-methods";
import { ZitadelError } from "../../lib/errors";
import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../../lib/idp";
import { stableStringify } from "../../lib/json";
import { BaseCommand, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { portableCommands } from "../../lib/public-cli";
import { flowsForSchema } from "../../lib/schema-flows";
import { reportWarning } from "../../lib/warnings";

/** `--schema`, which every `auth-method` command takes. */
export const SCHEMA_FLAG = {
  schema: nonBlankString({
    description: "User schema to change. Required when the Project has more than one.",
  }),
};

/**
 * `--force`, which only the disable commands take. Per command, not global
 * (ADR 064 §10): here it permits removing the last way to sign in, which the
 * server allows for a schema whose users are only managed through the API.
 */
export const FORCE_FLAG = {
  force: Flags.boolean({
    char: "f",
    description:
      "Disable the schema's last way to sign in. Its users can then only be managed through the API.",
  }),
};

/** A flow before and after a change, for the checks that compare the two. */
export type FlowChange = { readonly file: FlowFile; readonly after: Record<string, unknown> };

/** What every `auth-method` command reads before changing anything. */
type Target = {
  readonly cwd: string;
  /** `--cwd` for a follow-up command, or nothing when the user did not pass it. */
  readonly cwdArgs: string[];
  readonly schema: SchemaFile;
  readonly flows: FlowFile[];
};

/**
 * What the `auth-method` commands share (ADR 069): finding the schema and its
 * flows, the refusals in §3, the warnings in §4, and the result shape.
 *
 * Nothing here talks to a server. Edits are local, and `plan` and `apply`
 * publish them like any configuration change.
 */
export abstract class AuthMethodCommand extends BaseCommand {
  /**
   * The global flags, restated rather than only inherited. oclif collects a
   * command's static properties by walking up its classes, and stops at the
   * first one with none of its own; without this, a command two levels below
   * (the `sso enable` alias) would lose `--json`, `--cwd` and the rest from its
   * help and manifest, though not from parsing.
   */
  static override baseFlags = BaseCommand.baseFlags;

  /** Read the schema and the flows that run against it, refusing what cannot be edited. */
  protected async target(flags: { schema?: string; cwd?: string }): Promise<Target> {
    // A stopped local runtime must not block staging a change for a later apply.
    await this.toMeta(flags, { resolveServer: false });
    const { cwd } = this.meta;
    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    refuseExternalSchema(schema);
    return {
      cwd,
      // A follow-up run from where the user stands must reach the same Project.
      cwdArgs: flags.cwd === undefined ? [] : optionArgs("--cwd", cwd),
      schema,
      flows: await flowsForSchema(cwd, schema),
    };
  }

  /**
   * The last-method guard (ADR 069 §3). Returns `false` when the user declined
   * the prompt, which ends the run as skipped; refuses without `--force` when
   * nobody can be asked.
   */
  protected async confirmLastMethod(input: {
    schema: SchemaFile;
    after: Record<string, unknown>;
    disabling: string;
    retryArgs: string[];
    turningOff: readonly string[];
    cwdArgs: string[];
  }): Promise<boolean> {
    const { dryRun, force, nonInteractive, cliVersion } = this.meta;
    if (force || !removesLastMethod(input.schema.body, input.after)) {
      return true;
    }
    if (nonInteractive || dryRun) {
      // A dry run's suggestions stay previews: following one must not write.
      const preview = dryRun ? ["--dry-run"] : [];
      refuseLastMethod({
        schema: input.schema,
        retryArgs: [...input.retryArgs, ...input.cwdArgs, ...preview, "--force"],
        turningOff: input.turningOff,
        extraArgs: [...input.cwdArgs, ...preview],
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
   * Report what the change leaves behind (ADR 069 §4). Called once the change
   * is previewed or written, never before: a failed write must not claim it.
   */
  protected reportOutcome(input: {
    schema: SchemaFile;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    flowsAfter: readonly Record<string, unknown>[];
    notOffered: readonly string[];
  }): void {
    const { dryRun } = this.meta;
    for (const method of input.notOffered) {
      // Enabling first and editing the flow second is a normal order of work.
      reportWarning(
        `No login flow for ${input.schema.name} offers ${method} yet. Add it to a flow to show it.`,
      );
    }
    if (removesLastMethod(input.before, input.after)) {
      // Reached only through --force or a confirmed prompt: said even so.
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

  /** `plan` and `apply`, as strings when safe to run as written and as argument lists always. */
  protected followUps(changed: boolean, cwdArgs: string[]): Record<string, unknown> {
    const args = changed
      ? [
          ["plan", ...cwdArgs],
          ["apply", ...cwdArgs],
        ]
      : [];
    return { next_commands: portableCommands(args, this.meta.cliVersion), next_args: args };
  }

  /**
   * `auth-method password|passkey enable|disable`: set
   * `x-auth-methods.<method>.enabled` on one schema. Login flows are never
   * edited, so a change one of them would reject is refused instead.
   */
  protected async toggle(
    flags: { schema?: string; cwd?: string },
    method: AuthFactor,
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    const { cwd, cwdArgs, schema, flows } = await this.target(flags);
    const { dryRun } = this.meta;
    const verb = enabled ? "enable" : "disable";

    const malformed = malformedAuthMethods(schema.body, [method]);
    if (malformed !== undefined) {
      throw malformedRefusal(schema, malformed);
    }
    const change = setAuthFactors(schema.body, [method], enabled);
    const changed = change.changed.length > 0;
    if (changed) {
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
        turningOff: [method],
        cwdArgs,
      });
      if (!proceed) {
        return this.emit({ status: "skipped", reason: "disable-cancelled" });
      }
    }

    const flowsAfter = activeBodies(flows.map((file) => file.body));
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
      changed,
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
        pretty: changed
          ? `Would ${verb} ${method} for ${schema.name}`
          : `Nothing to ${verb} for ${schema.name}`,
      });
    }
    if (changed) {
      await writeFile(join(cwd, schema.path), `${stableStringify(change.document)}\n`);
      consola.success(`Updated ${schema.path}`);
    } else {
      consola.info(`${method} is already ${verb}d for ${schema.name}`);
    }
    this.reportOutcome(outcome);
    return this.emit({
      status: "ok",
      data: { ...data, ...this.followUps(changed, cwdArgs) },
      pretty: changed
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
export function refuseExternalSchema(schema: SchemaFile): void {
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

/** Only an active flow is served, so only active flows decide what is offered. */
export function activeBodies(flows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return flows.filter((flow) => flow.status === "active");
}

/** Whether a change takes the schema from some way to sign in to none. */
function removesLastMethod(before: Record<string, unknown>, after: Record<string, unknown>) {
  return usableSignInMethods(before).length > 0 && usableSignInMethods(after).length === 0;
}

/** A value of the wrong shape is refused rather than overwritten. */
export function malformedRefusal(schema: SchemaFile, region: string): ZitadelError {
  return new ZitadelError("E_VALIDATION", `${schema.path}: ${region}`, {
    hint:
      "This command edits that value, and it is not the shape it edits. " +
      "Fix it against the dialect in .zitadel/meta/, then run the command again.",
    details: { file: schema.path, region },
  });
}

/** The server refuses password on a schema with no identifier to look users up by. */
function refuseMissingIdentifier(schema: SchemaFile, method: AuthFactor): void {
  if (method !== "password" || hasIdentifier(schema.body)) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${schema.path} has no x-identifier for password`, {
    hint:
      "A password is checked against the user found by the schema's identifier. " +
      'Set "x-identifier" to the property users sign in with, e.g. "email", then run the command again.',
    details: { file: schema.path, factor: "password" },
  });
}

/**
 * Refuse removing the last way in without --force. The exact re-run comes
 * first; the alternatives are methods this run is not turning off, and
 * password only where the schema can take it (it needs an identifier).
 */
function refuseLastMethod(input: {
  schema: SchemaFile;
  retryArgs: string[];
  turningOff: readonly string[];
  extraArgs: string[];
  cliVersion: string;
}): never {
  const { schema } = input;
  const alternatives = AUTH_FACTORS.filter(
    (method) =>
      !input.turningOff.includes(method) && (method !== "password" || hasIdentifier(schema.body)),
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
      ...input.extraArgs,
    ]),
  ];
  throw new ZitadelError("E_VALIDATION", `${schema.path} would have no way to sign in left`, {
    hint:
      "Enable another method first, such as `zitadel auth-method sso enable --provider <name>`. " +
      "If the schema's users are only managed through the API, re-run with --force " +
      "(details.retry_args holds the exact arguments).",
    details: {
      file: schema.path,
      usable: usableSignInMethods(schema.body),
      retry_args: input.retryArgs,
      suggested_args: suggestedArgs,
    },
    nextCommands: portableCommands(suggestedArgs, input.cliVersion),
  });
}

/**
 * Refuse when a flow running against the schema would stop validating once
 * the schema and the flows are changed, or cannot be checked at all.
 */
export function refuseBrokenFlows(
  schema: SchemaFile,
  after: Record<string, unknown>,
  flows: readonly FlowChange[],
  // What to say about errors the change introduces. Neutral by default; the
  // disable commands that leave flows alone say which method is still used.
  introduced: { heading: string; hint: string } = {
    heading: "A login flow would stop validating after this change:",
    hint: "Fix the steps named above, then run the command again.",
  },
): void {
  const unchecked: Array<{ path: string; issue: FlowValidationIssue }> = [];
  const added: Array<{ path: string; issue: FlowValidationIssue }> = [];
  for (const { file, after: flowAfter } of flows) {
    const check = checkFlow(file.body, schema.body, after, flowAfter);
    if (check.kind === "unchecked") {
      unchecked.push(...check.issues.map((issue) => ({ path: file.path, issue })));
    } else {
      added.push(...check.introduced.map((issue) => ({ path: file.path, issue })));
    }
  }
  if (unchecked.length > 0) {
    throw flowRefusal(
      schema.path,
      unchecked,
      "A login flow has errors, so it cannot be checked against the changed schema:",
      "Fix those errors first (`zitadel plan` reports them too), then run the command again.",
    );
  }
  if (added.length > 0) {
    throw flowRefusal(schema.path, added, introduced.heading, introduced.hint);
  }
}

function flowRefusal(
  file: string,
  issues: ReadonlyArray<{ path: string; issue: FlowValidationIssue }>,
  heading: string,
  hint: string,
): ZitadelError {
  return new ZitadelError(
    "E_VALIDATION",
    `${heading}\n${issues.map(({ path, issue }) => `  - ${path}: ${issue.message}`).join("\n")}`,
    {
      hint,
      details: {
        file,
        issues: issues.map(({ path, issue }) => ({
          path,
          rule: issue.rule,
          message: issue.message,
          ...(issue.step === undefined ? {} : { step: issue.step }),
        })),
      },
    },
  );
}

/**
 * An option and its value as arguments. A value that starts with `-` would be
 * read as the next flag, so it is joined with `=` instead. That token is not a
 * portable shell word, so it also keeps the string form out of next_commands.
 */
export function optionArgs(option: string, value: string): string[] {
  return value.startsWith("-") ? [`${option}=${value}`] : [option, value];
}
