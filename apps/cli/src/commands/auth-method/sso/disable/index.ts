import { AuthMethodCommand } from "../../command";
import { removableFlows } from "./requirements/flows";
import { providerToRemove } from "./requirements/provider";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";

import { refuseBrokenFlows, usableSignInMethods } from "../../../../lib/auth-methods";
import { removeSsoFromFlow, removeSsoFromSchema } from "../../../../lib/idp";
import { stableStringify } from "../../../../lib/json";
import {
  type Admitted,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../../../lib/oclif";
import { optionArgs } from "../../../../lib/public-cli";

/**
 * `auth-method sso disable` (ADR 070 §2): remove one provider from a schema
 * and from the login flows that run against it.
 *
 * The connection file and its published credentials are kept, so enabling the
 * provider again does not ask for them. The routes and steps
 * `auth-method sso enable` added stay in the flows; without a provider they
 * are never reached.
 */
export default class AuthMethodSsoDisable extends AuthMethodCommand {
  static override description = "Remove an identity provider from a user schema.";
  static override group = CommandGroups.authentication;
  static override examples = [
    "<%= config.bin %> auth-method sso disable --provider google",
    "<%= config.bin %> auth-method sso disable --provider google --schema customers",
  ];
  static override flags = {
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

  static override requires = {
    ...AuthMethodCommand.requires,
    provider: providerToRemove,
    flows: removableFlows,
  };

  protected async execute({
    target,
    provider,
    flows,
  }: Admitted<typeof AuthMethodSsoDisable>): Promise<JsonEnvelope> {
    const { cwd, cwdArgs, schema } = target;

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
    }
    const permit = await this.lastMethodPermit({
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
    if (permit === undefined) {
      return this.emit({ status: "skipped", reason: "disable-cancelled" });
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

    if (this.dryRun) {
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
      await this.writeSchema(cwd, schema, after, permit);
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
    const followUps = this.followUps(changed.length > 0, cwdArgs);
    return this.emit({
      status: "ok",
      data: { ...data, next_args: followUps.args },
      next: { commands: followUps.commands },
      pretty:
        changed.length > 0
          ? `Removed ${provider} from ${where}`
          : `${schema.name} does not offer ${provider}`,
    });
  }
}
