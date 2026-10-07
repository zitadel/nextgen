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
  flowOffers,
  hasIdentifier,
  malformedAuthMethods,
  reachableSignInMethods,
  setAuthFactors,
  usableSignInMethods,
} from "../../lib/auth-factors";
import { ZitadelError } from "../../lib/errors";
import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../../lib/idp";
import { stableStringify } from "../../lib/json";
import { BaseCommand, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { portableCommands } from "../../lib/public-cli";
import { flowsForSchema } from "../../lib/schema-flows";
import { reportWarning } from "../../lib/warnings";

/** The flags `auth-factor enable` and `auth-factor disable` share. */
export const AUTH_FACTOR_FLAGS = {
  // Not `required`, for the same reason `sso enable --provider` is not: the
  // refusal below names the next move, and oclif's own would not.
  mode: Flags.string({
    options: [...AUTH_FACTORS],
    multiple: true,
    description: "Factor to change. Repeat it to change several.",
  }),
  schema: nonBlankString({
    description: "User schema to change. Required when the Project has more than one.",
  }),
};

/**
 * What `auth-factor enable` and `auth-factor disable` both do (ADR 068): set
 * `x-auth-methods.<factor>.enabled` on one local user schema and leave
 * publishing to `plan` and `apply`.
 *
 * Login flows are never edited. A change that `plan` or `apply` would reject
 * is refused before anything is written, dry run or not, because the developer
 * is better told now which file to change.
 */
export abstract class AuthFactorCommand extends BaseCommand {
  protected async toggle(
    flags: { mode?: string[]; schema?: string; cwd?: string },
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    // Nothing here talks to a server, so none is resolved: a stopped local
    // runtime must not block staging a change for a later apply.
    await this.toMeta(flags, { resolveServer: false });
    const { cwd, dryRun, force, nonInteractive, cliVersion } = this.meta;
    // A follow-up run from where the user stands must reach the same Project.
    const cwdArgs = flags.cwd === undefined ? [] : optionArgs("--cwd", cwd);
    const verb = enabled ? "enable" : "disable";

    const factors = [...new Set(flags.mode ?? [])] as AuthFactor[];
    if (factors.length === 0) {
      throw new ZitadelError("E_VALIDATION", `Name the factor to ${verb}`, {
        hint: `Pass --mode, e.g. --mode ${AUTH_FACTORS[0]}. Repeat it to change several.`,
      });
    }

    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    if (schema.body.kind === "schema-url") {
      throw new ZitadelError("E_VALIDATION", `${schema.path} points at an external schema`, {
        hint:
          "Its sign-in methods live in the schema at its url, which the server fetches. " +
          "Edit x-auth-methods there instead.",
        details: { file: schema.path, url: schema.body.url },
      });
    }
    const malformed = malformedAuthMethods(schema.body, factors);
    if (malformed !== undefined) {
      throw new ZitadelError("E_VALIDATION", `${schema.path}: ${malformed}`, {
        hint:
          "This command edits that value, and it is not the shape it edits. " +
          "Fix it against the dialect in .zitadel/meta/, then run the command again.",
        details: { file: schema.path, region: malformed },
      });
    }
    const change = setAuthFactors(schema.body, factors, enabled);
    const flows = await flowsForSchema(cwd, schema);

    const lastFactor =
      !enabled && change.changed.length > 0 && usableSignInMethods(change.document).length === 0;
    if (change.changed.length > 0) {
      if (enabled) {
        refuseMissingIdentifier(schema, change.changed);
      }
      // Both directions: a changed schema re-pins its flows, so `plan` would
      // reject one it cannot check either way. Before the last-factor guard,
      // because these refusals have no override, and nobody should be asked
      // to confirm a change that fails anyway.
      refuseBrokenFlows(schema, change.document, flows);
    }
    if (lastFactor && !force) {
      // ADR 064 §10: a terminal asks; a script or a dry run needs --force.
      if (nonInteractive || dryRun) {
        // A dry run's suggestions stay previews: following one must not write.
        refuseLastFactor(
          schema,
          factors,
          [...cwdArgs, ...(dryRun ? ["--dry-run"] : [])],
          cliVersion,
        );
      }
      const answer = await confirm({
        message: `Disable ${change.changed.join(", ")} anyway? Nobody will be able to sign in to ${schema.name}.`,
        initialValue: false,
      });
      if (isCancel(answer) || !answer) {
        cancel("Disable cancelled.");
        return this.emit({ status: "skipped", reason: "disable-cancelled" });
      }
    }

    // Only an active flow is served, so a draft offering the factor does not
    // put it on the sign-in screen.
    const activeFlows = flows.filter((flow) => flow.body.status === "active");
    const notOffered = enabled
      ? factors.filter((factor) => !activeFlows.some((flow) => flowOffers(flow.body, factor)))
      : [];
    // Enabling first and editing the flow second is a normal order of work, so
    // this is a warning rather than a refusal.
    const warnings = notOffered.map(
      (factor) =>
        `No login flow for ${schema.name} offers ${factor} yet. Add it to a flow to show it.`,
    );
    if (lastFactor) {
      // Reached only through --force or a confirmed prompt: said even so,
      // because nobody can sign in.
      warnings.push(
        `${schema.name} ${dryRun ? "would have" : "has"} no way to sign in left. ` +
          "Its users can only be managed through the API.",
      );
    }
    if (
      !lastFactor &&
      reachableSignInMethods(
        change.document,
        activeFlows.map((flow) => flow.body),
      ).length === 0
    ) {
      // The schema still enables something, but no active flow offers it, so
      // the sign-in screen has no way in. Flows are not this command's to edit
      // (ADR 068 §3), so it says so rather than refusing.
      warnings.push(
        `No active login flow for ${schema.name} offers a factor it enables, ` +
          "so nobody can sign in until one does.",
      );
    }
    // Reported rather than returned, so a terminal shows them and a dry run's
    // envelope carries them too (see apps/cli/AGENTS.md). They describe the
    // schema after the change, so they are reported only once the change is
    // previewed or written: a failed write must not claim it happened.
    const reportAll = () => {
      for (const warning of warnings) {
        reportWarning(warning);
      }
    };
    const data = {
      schema: schema.name,
      file: schema.path,
      changed: change.changed,
      unchanged: change.unchanged,
      usable: usableSignInMethods(change.document),
      not_offered: notOffered,
    };

    if (dryRun) {
      reportAll();
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty:
          change.changed.length === 0
            ? `Nothing to ${verb} for ${schema.name}`
            : `Would ${verb} ${change.changed.join(", ")} for ${schema.name}`,
      });
    }

    if (change.changed.length > 0) {
      await writeFile(join(cwd, schema.path), `${stableStringify(change.document)}\n`);
      consola.success(`Updated ${schema.path}`);
    }
    reportAll();
    for (const factor of change.unchanged) {
      consola.info(`${factor} is already ${verb}d for ${schema.name}`);
    }

    const followUps =
      change.changed.length === 0
        ? []
        : [
            ["plan", ...cwdArgs],
            ["apply", ...cwdArgs],
          ];
    return this.emit({
      status: "ok",
      data: {
        ...data,
        // The edit is local until it is applied, like any configuration file.
        // `next_args` always holds the argument lists; `next_commands` has the
        // strings only when every argument is safe to run as written.
        next_commands: portableCommands(followUps, cliVersion),
        next_args: followUps,
      },
      pretty:
        change.changed.length === 0
          ? `Nothing to ${verb} for ${schema.name}`
          : `${enabled ? "Enabled" : "Disabled"} ${change.changed.join(", ")} for ${schema.name}`,
    });
  }
}

/** The server refuses password on a schema with no identifier to look users up by. */
function refuseMissingIdentifier(schema: SchemaFile, changed: readonly AuthFactor[]): void {
  if (!changed.includes("password") || hasIdentifier(schema.body)) {
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
 * first; the alternatives are factors this run is not disabling, and password
 * only where the schema can take it (it needs an identifier).
 */
function refuseLastFactor(
  schema: SchemaFile,
  disabling: readonly AuthFactor[],
  cwdArgs: readonly string[],
  cliVersion: string,
): never {
  // Always given as an argument list, which no shell interprets.
  const retryArgs = [
    "auth-factor",
    "disable",
    ...disabling.flatMap((factor) => ["--mode", factor]),
    ...optionArgs("--schema", schema.name),
    ...cwdArgs,
    "--force",
  ];
  const alternatives = AUTH_FACTORS.filter(
    (factor) =>
      !disabling.includes(factor) && (factor !== "password" || hasIdentifier(schema.body)),
  );
  // The schema name comes from a file name and the --cwd path from the user.
  // One that would need quoting leaves the strings out: quoting differs
  // between POSIX shells, PowerShell and cmd.exe, so none is safe on all.
  const suggestedArgs = [
    retryArgs,
    ...alternatives.map((factor) => [
      "auth-factor",
      "enable",
      "--mode",
      factor,
      ...optionArgs("--schema", schema.name),
      ...cwdArgs,
    ]),
  ];
  const nextCommands = portableCommands(suggestedArgs, cliVersion);
  throw new ZitadelError("E_VALIDATION", `${schema.path} would have no way to sign in left`, {
    hint:
      "Enable another factor or an identity provider (`sso enable --provider <name>`) first. " +
      "If the schema's users are only managed through the API, re-run with --force " +
      "(details.retry_args holds the exact arguments).",
    details: {
      file: schema.path,
      usable: usableSignInMethods(schema.body),
      retry_args: retryArgs,
      // Every suggestion as an argument list, the re-run first: when
      // next_commands is empty because a value needs quoting, this keeps
      // the safer alternatives too.
      suggested_args: suggestedArgs,
    },
    nextCommands,
  });
}

/** Refuse when a flow running against the schema would stop validating, or cannot be checked. */
function refuseBrokenFlows(
  schema: SchemaFile,
  after: Record<string, unknown>,
  flows: readonly FlowFile[],
): void {
  const unchecked: Array<{ path: string; issue: FlowValidationIssue }> = [];
  const introduced: Array<{ path: string; issue: FlowValidationIssue }> = [];
  for (const flow of flows) {
    const check = checkFlow(flow.body, schema.body, after);
    if (check.kind === "unchecked") {
      unchecked.push(...check.issues.map((issue) => ({ path: flow.path, issue })));
    } else {
      introduced.push(...check.introduced.map((issue) => ({ path: flow.path, issue })));
    }
  }
  if (unchecked.length > 0) {
    throw flowRefusal(
      schema.path,
      unchecked,
      "A login flow has errors, so it cannot be checked against the changed schema:",
      "Fix those errors first (`plan` reports them too), then run the command again.",
    );
  }
  if (introduced.length > 0) {
    throw flowRefusal(
      schema.path,
      introduced,
      `A login flow still uses what ${schema.path} would disable:`,
      "Remove the factor from those steps first, then run the command again. Login flows are not edited for you.",
    );
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
function optionArgs(option: string, value: string): string[] {
  return value.startsWith("-") ? [`${option}=${value}`] : [option, value];
}
