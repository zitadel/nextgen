import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";
import type { FlowValidationIssue } from "@zitadel/config/validate";
import { consola } from "consola";

import {
  AUTH_FACTORS,
  type AuthFactor,
  checkFlow,
  flowOffers,
  hasIdentifier,
  setAuthFactors,
  usableSignInMethods,
} from "../../lib/auth-factors";
import { ZitadelError } from "../../lib/errors";
import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../../lib/idp";
import { stableStringify } from "../../lib/json";
import { BaseCommand, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { publicCliCommand } from "../../lib/public-cli";
import { flowsForSchema } from "../../lib/schema-flows";

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
    flags: { mode?: string[]; schema?: string },
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    await this.toMeta(flags);
    const { cwd, dryRun, force, cliVersion } = this.meta;
    const verb = enabled ? "enable" : "disable";

    const factors = [...new Set(flags.mode ?? [])] as AuthFactor[];
    if (factors.length === 0) {
      throw new ZitadelError("E_VALIDATION", `Name the factor to ${verb}`, {
        hint: `Pass --mode, e.g. --mode ${AUTH_FACTORS[0]}. Repeat it to change several.`,
      });
    }

    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    const change = setAuthFactors(schema.body, factors, enabled);
    const flows = await flowsForSchema(cwd, schema);

    if (change.changed.length > 0) {
      if (enabled) {
        refuseMissingIdentifier(schema, change.changed);
      } else {
        if (!force) {
          refuseLastFactor(schema, change.document, cliVersion);
        }
        refuseBrokenFlows(schema, change.document, flows);
      }
    }

    const notOffered = enabled
      ? factors.filter((factor) => !flows.some((flow) => flowOffers(flow.body, factor)))
      : [];
    // Enabling first and editing the flow second is a normal order of work, so
    // this is a warning rather than a refusal.
    const warnings = notOffered.map(
      (factor) =>
        `No login flow for ${schema.name} offers ${factor} yet. Add it to a flow to show it.`,
    );
    if (
      !enabled &&
      change.changed.length > 0 &&
      usableSignInMethods(change.document).length === 0
    ) {
      // Only reachable with --force: said even so, because nobody can sign in.
      warnings.push(
        `${schema.name} has no way to sign in left. Its users can only be managed through the API.`,
      );
    }
    const data = {
      schema: schema.name,
      file: schema.path,
      changed: change.changed,
      unchanged: change.unchanged,
      enabled: usableSignInMethods(change.document),
      not_offered: notOffered,
    };

    if (dryRun) {
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
    for (const factor of change.unchanged) {
      consola.info(`${factor} is already ${verb}d for ${schema.name}`);
    }

    return this.emit({
      status: "ok",
      data: {
        ...data,
        // The edit is local until it is applied, like any configuration file.
        next_commands:
          change.changed.length === 0
            ? []
            : [publicCliCommand("plan", cliVersion), publicCliCommand("apply", cliVersion)],
      },
      warnings,
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

/** A schema with no usable way in cannot be signed in to by anyone. */
function refuseLastFactor(
  schema: SchemaFile,
  after: Record<string, unknown>,
  cliVersion: string,
): void {
  if (usableSignInMethods(after).length > 0) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${schema.path} would have no way to sign in left`, {
    hint:
      "Enable another factor or an identity provider first. If the schema's users are only " +
      "managed through the API, pass --force to disable it anyway.",
    details: { file: schema.path, usable: usableSignInMethods(schema.body) },
    nextCommands: AUTH_FACTORS.filter(
      (factor) => !usableSignInMethods(schema.body).includes(factor),
    )
      .map((factor) =>
        publicCliCommand(`auth-factor enable --mode ${factor} --schema ${schema.name}`, cliVersion),
      )
      .concat(publicCliCommand(`sso enable --schema ${schema.name}`, cliVersion)),
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
      "A login flow has errors, so it cannot be checked for the factor being disabled:",
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
