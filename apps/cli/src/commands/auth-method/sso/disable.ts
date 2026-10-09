import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";
import { IDP_PROVIDERS } from "@zitadel/config/idp";
import { consola } from "consola";

import {
  listedProviders,
  refuseBrokenFlows,
  refuseUneditable,
  usableSignInMethods,
} from "../../../lib/auth-methods";
import { ZitadelError } from "../../../lib/errors";
import {
  removeSsoFromFlow,
  removeSsoFromSchema,
  ssoEditRefusal,
  ssoProvidersRefusal,
} from "../../../lib/idp";
import { stableStringify } from "../../../lib/json";
import {
  AuthMethodCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../../lib/oclif";
import { optionArgs } from "../../../lib/public-cli";

/**
 * `auth-method sso disable` (ADR 069 §2): remove one provider from a schema
 * and from the login flows that run against it.
 *
 * The connection file and its published credentials are kept, so enabling the
 * provider again does not ask for them. The routes and steps
 * `auth-method sso enable` added stay in the flows; without a provider they
 * are never reached.
 */
export default class AuthMethodSsoDisable extends AuthMethodCommand {
  static override description = "Remove an identity provider from a user schema.";
  static override group = CommandGroups.configuration;
  static override examples = [
    "<%= config.bin %> auth-method sso disable --provider google",
    "<%= config.bin %> auth-method sso disable --provider google --schema customers",
  ];
  static override flags = {
    // Not `required`, as on `auth-method sso enable`: the refusal below names
    // the next move, and oclif's own would not. A provider is always named,
    // because removing every provider at once would be a different, larger
    // change.
    provider: nonBlankString({ description: "Identity provider to remove." }),
    // `--force` is per command, not global (ADR 064 §10): here it permits
    // removing the last way to sign in, which the server allows for a schema
    // whose users are only managed through the API.
    force: Flags.boolean({
      char: "f",
      description:
        "Disable the schema's last way to sign in. Its users can then only be managed through the API.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(AuthMethodSsoDisable);
    const { cwd, cwdArgs, schema, flows } = await this.target(flags);
    const { dryRun } = this.meta;

    const provider = flags.provider;
    if (provider === undefined) {
      // Every provider the schema lists, well-formed or not: any of them is
      // one the developer may want to remove.
      throw new ZitadelError("E_VALIDATION", "Name the provider to remove", {
        hint: `Pass --provider, e.g. --provider ${IDP_PROVIDERS[0]}. ${schema.name} offers: ${listedProviders(schema.body).join(", ") || "none"}.`,
      });
    }
    // The same shapes `auth-method sso enable` refuses: a region that is not
    // what these editors write is someone's, and is not overwritten.
    refuseUneditable(schema.path, ssoEditRefusal(schema.body, "schema"));
    for (const file of flows) {
      refuseUneditable(file.path, ssoProvidersRefusal(file.body));
    }

    const schemaChange = removeSsoFromSchema(schema.body, provider);
    const after = schemaChange.document as Record<string, unknown>;
    const flowChanges = flows.map((file) => {
      const change = removeSsoFromFlow(file.body, provider);
      return {
        file,
        after: change.document as Record<string, unknown>,
        changed: change.changed,
      };
    });
    const changedFlows = flowChanges.filter((change) => change.changed);
    const changed = [
      ...(schemaChange.changed ? [schema.path] : []),
      ...changedFlows.map(({ file }) => file.path),
    ];

    if (changed.length > 0) {
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
        cwdArgs,
      });
      if (!proceed) {
        return this.emit({ status: "skipped", reason: "disable-cancelled" });
      }
    }

    // When only a flow still offered the provider, say so: the schema itself
    // did not change.
    const where = schemaChange.changed ? schema.name : `the login flows of ${schema.name}`;
    const data = {
      schema: schema.name,
      file: schema.path,
      method: "sso",
      provider,
      changed,
      usable: usableSignInMethods(after),
    };
    const outcome = {
      schema,
      before: schema.body,
      after,
      flowsAfter: flowChanges.map(({ after: body }) => body),
    };

    if (dryRun) {
      this.reportOutcome(outcome);
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty:
          changed.length > 0
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
    for (const path of changed) {
      consola.success(`Updated ${path}`);
    }
    if (changed.length === 0) {
      consola.info(`${schema.name} does not offer ${provider}`);
    }
    this.reportOutcome(outcome);
    return this.emit({
      status: "ok",
      data: { ...data, ...this.followUps(changed.length > 0, cwdArgs) },
      pretty:
        changed.length > 0
          ? `Removed ${provider} from ${where}`
          : `${schema.name} does not offer ${provider}`,
    });
  }
}
