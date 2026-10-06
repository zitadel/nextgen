import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  AUTH_MODES,
  type AuthMode,
  enabledSignInMethods,
  flowOffers,
  introducedFlowErrors,
  setAuthModes,
} from "../../lib/auth-methods";
import { ZitadelError } from "../../lib/errors";
import { readSchemaFiles, selectSchema } from "../../lib/idp";
import { stableStringify } from "../../lib/json";
import { BaseCommand, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { publicCliCommand } from "../../lib/public-cli";
import { flowsForSchema } from "../../lib/schema-flows";

/** The flags `auth enable` and `auth disable` share. */
export const AUTH_TOGGLE_FLAGS = {
  // Not `required`, for the same reason `sso enable --provider` is not: the
  // refusal below names the next move, and oclif's own would not.
  mode: Flags.string({
    options: [...AUTH_MODES],
    multiple: true,
    description: "Sign-in method to change. Repeat it to change several.",
  }),
  schema: nonBlankString({
    description: "User schema to change. Required when the Project has more than one.",
  }),
};

/**
 * What `auth enable` and `auth disable` both do (ADR 070): set
 * `x-auth-methods.<mode>.enabled` on one local user schema and leave
 * publishing to `plan` and `apply`.
 *
 * Login flows are never edited. A change that would leave a flow asking for a
 * method the schema no longer enables is refused before anything is written,
 * because `plan` would reject it anyway and the developer is better told now
 * which step to change.
 */
export abstract class AuthToggleCommand extends BaseCommand {
  protected async toggle(
    flags: { mode?: string[]; schema?: string },
    enabled: boolean,
  ): Promise<JsonEnvelope> {
    await this.toMeta(flags);
    const { cwd, dryRun, cliVersion } = this.meta;
    const verb = enabled ? "enable" : "disable";

    const modes = [...new Set(flags.mode ?? [])] as AuthMode[];
    if (modes.length === 0) {
      throw new ZitadelError("E_VALIDATION", `Name the sign-in method to ${verb}`, {
        hint: `Pass --mode, e.g. --mode ${AUTH_MODES[0]}. Repeat it to change several.`,
      });
    }

    const schema = selectSchema(await readSchemaFiles(cwd), flags.schema);
    const change = setAuthModes(schema.body, modes, enabled);
    const flows = await flowsForSchema(cwd, schema);

    if (!enabled && change.changed.length > 0) {
      refuseLastMethod(schema.path, schema.body, change.document);
      refuseBrokenFlows(schema.path, schema.body, change.document, flows);
    }

    const notOffered = enabled
      ? modes.filter((mode) => !flows.some((flow) => flowOffers(flow.body, mode)))
      : [];
    const data = {
      schema: schema.name,
      file: schema.path,
      changed: change.changed,
      unchanged: change.unchanged,
      enabled: enabledSignInMethods(change.document),
      not_offered: notOffered,
    };

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty:
          change.changed.length === 0
            ? `Nothing to ${verb} in ${schema.path}`
            : `Would ${verb} ${change.changed.join(", ")} in ${schema.path}`,
      });
    }

    if (change.changed.length > 0) {
      await writeFile(join(cwd, schema.path), `${stableStringify(change.document)}\n`);
      consola.success(`Updated ${schema.path}`);
    }
    for (const mode of change.unchanged) {
      consola.info(`${mode} is already ${verb}d for ${schema.name}`);
    }
    for (const mode of notOffered) {
      // Enabling first and editing the flow second is a normal order of work,
      // so this is said rather than refused.
      consola.warn(
        `No login flow for ${schema.name} offers ${mode} yet. Add it to a flow to show it.`,
      );
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
      pretty:
        change.changed.length === 0
          ? `Nothing to ${verb} in ${schema.name}`
          : `${enabled ? "Enabled" : "Disabled"} ${change.changed.join(", ")} for ${schema.name}`,
    });
  }
}

/** A schema with no method left cannot be signed in to by anyone. */
function refuseLastMethod(
  path: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  if (enabledSignInMethods(after).length > 0) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${path} would have no sign-in method left`, {
    hint: "Enable another method first, with `auth enable --mode <method>` or `sso enable`.",
    details: { file: path, enabled: enabledSignInMethods(before) },
  });
}

/** Refuse when a flow running against the schema would stop validating. */
function refuseBrokenFlows(
  path: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  flows: readonly { path: string; body: Record<string, unknown> }[],
): void {
  const issues = flows.flatMap((flow) =>
    introducedFlowErrors(flow.body, before, after).map((issue) => ({ path: flow.path, issue })),
  );
  if (issues.length === 0) {
    return;
  }
  throw new ZitadelError(
    "E_VALIDATION",
    `A login flow still uses what ${path} would disable:\n` +
      issues.map(({ path: flow, issue }) => `  - ${flow}: ${issue.message}`).join("\n"),
    {
      hint: "Remove the method from those steps first, then run the command again. Login flows are not edited for you.",
      details: {
        file: path,
        issues: issues.map(({ path: flow, issue }) => ({
          path: flow,
          rule: issue.rule,
          message: issue.message,
          ...(issue.step === undefined ? {} : { step: issue.step }),
        })),
      },
    },
  );
}
