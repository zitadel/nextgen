import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { consola } from "consola";

import { usableSignInMethods } from "../../../lib/auth-methods";
import { ZitadelError } from "../../../lib/errors";
import {
  removeSsoFromFlow,
  removeSsoFromSchema,
  ssoEditRefusal,
  ssoProvidersRefusal,
} from "../../../lib/idp";
import { isObject, stableStringify } from "../../../lib/json";
import { CommandGroups, type JsonEnvelope, nonBlankString } from "../../../lib/oclif";
import {
  activeBodies,
  AuthMethodCommand,
  FORCE_FLAG,
  malformedRefusal,
  optionArgs,
  refuseBrokenFlows,
  SCHEMA_FLAG,
} from "../shared";

/**
 * `auth-method sso disable` (ADR 069 §2): remove one provider from a schema
 * and from the login flows that run against it.
 *
 * The connection file and its published credentials are kept, so enabling the
 * provider again does not ask for them. The routes and steps `auth-method sso enable`
 * added stay in the flows; without a provider they are never reached.
 */
export default class SsoDisable extends AuthMethodCommand {
  static override description = "Remove an identity provider from a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method sso disable --provider google",
    "<%= config.bin %> auth-method sso disable --provider google --schema customers",
  ];
  static override flags = {
    // Not `required`, as on `auth-method sso enable`: the refusal below names the next
    // move, and oclif's own would not. A provider is always named, because
    // removing every provider at once would be a different, larger change.
    provider: nonBlankString({ description: "Identity provider to remove." }),
    ...SCHEMA_FLAG,
    ...FORCE_FLAG,
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(SsoDisable);
    const { cwd, cwdArgs, schema, flows } = await this.target(flags);
    const { dryRun } = this.meta;

    const provider = flags.provider;
    if (provider === undefined) {
      throw new ZitadelError("E_VALIDATION", "Name the provider to remove", {
        hint: `Pass --provider, e.g. --provider google. ${schema.name} offers: ${offered(schema.body).join(", ") || "none"}.`,
      });
    }
    // The same shapes `auth-method sso enable` refuses: a region that is not what these
    // editors write is someone's, and is not overwritten.
    const malformed = ssoEditRefusal(schema.body, "schema");
    if (malformed !== undefined) {
      throw malformedRefusal(schema, malformed);
    }
    for (const file of flows) {
      const refusal = ssoProvidersRefusal(file.body);
      if (refusal !== undefined) {
        throw new ZitadelError("E_VALIDATION", `${file.path}: ${refusal}`, {
          hint:
            "This command edits that region, and it is not the shape it edits. " +
            "Fix it against the dialect in .zitadel/meta/, then run the command again.",
          details: { file: file.path, region: refusal },
        });
      }
    }

    const schemaChange = removeSsoFromSchema(schema.body, provider);
    const flowChanges = flows.map((file) => ({
      file,
      after: removeSsoFromFlow(file.body, provider).document as Record<string, unknown>,
    }));
    const after = schemaChange.document as Record<string, unknown>;
    const changedFlows = flowChanges.filter(({ file, after: body }) => body !== file.body);
    const changed = schemaChange.changed || changedFlows.length > 0;

    if (changed) {
      // Before the last-method guard: these refusals have no override, so
      // nobody should be asked to confirm a change that fails anyway.
      refuseBrokenFlows(schema, after, flowChanges);
      const proceed = await this.confirmLastMethod({
        schema,
        after,
        disabling: provider,
        retryArgs: [
          "auth-method",
          "sso",
          "disable",
          ...optionArgs("--provider", provider),
          ...optionArgs("--schema", schema.name),
        ],
        turningOff: [],
        cwdArgs,
      });
      if (!proceed) {
        return this.emit({ status: "skipped", reason: "disable-cancelled" });
      }
    }

    // When only a flow still offered the provider, say so: the schema itself
    // did not change.
    const where = schemaChange.changed ? schema.name : `the login flows of ${schema.name}`;
    const files = [
      ...(schemaChange.changed ? [schema.path] : []),
      ...changedFlows.map(({ file }) => file.path),
    ];
    const data = {
      schema: schema.name,
      file: schema.path,
      method: "sso",
      provider,
      changed,
      files,
      usable: usableSignInMethods(after),
    };
    const outcome = {
      schema,
      before: schema.body,
      after,
      flowsAfter: activeBodies(flowChanges.map(({ after: body }) => body)),
      notOffered: [],
    };

    if (dryRun) {
      this.reportOutcome(outcome);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty: changed
          ? `Would remove ${provider} from ${where}`
          : `${schema.name} does not offer ${provider}`,
      });
    }
    if (schemaChange.changed) {
      await writeFile(join(cwd, schema.path), `${stableStringify(after)}\n`);
    }
    for (const { file, after: body } of changedFlows) {
      await writeFile(join(cwd, file.path), `${stableStringify(body)}\n`);
    }
    for (const path of files) {
      consola.success(`Updated ${path}`);
    }
    if (!changed) {
      consola.info(`${schema.name} does not offer ${provider}`);
    }
    this.reportOutcome(outcome);
    return this.emit({
      status: "ok",
      data: { ...data, ...this.followUps(changed, cwdArgs) },
      pretty: changed
        ? `Removed ${provider} from ${where}`
        : `${schema.name} does not offer ${provider}`,
    });
  }
}

/** The providers a schema lists, for the hint when none is named. */
function offered(schema: Record<string, unknown>): string[] {
  const methods = schema["x-auth-methods"];
  const sso = isObject(methods) ? methods.sso : undefined;
  return isObject(sso) && Array.isArray(sso.providers)
    ? sso.providers.filter((p): p is string => typeof p === "string")
    : [];
}
