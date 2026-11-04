import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Flags } from "@oclif/core";
import { consola } from "consola";
import { IDP_PROVIDERS } from "@zitadel/config/idp";

import {
  listedProviders,
  refuseBrokenFlows,
  refuseUneditable,
  usableSignInMethods,
} from "../../../../lib/auth-methods";
import { readDirIfExists } from "../../../../lib/fs";
import {
  type FlowFile,
  IDPS_DIR,
  removeSsoFromFlow,
  removeSsoFromSchema,
  ssoEditRefusal,
  ssoProvidersRefusal,
} from "../../../../lib/idp";
import { type Refusal, refusalError } from "../../../../lib/oclif/refusal";
import { isObject, stableStringify } from "../../../../lib/json";
import {
  type Admitted,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../../../lib/oclif";
import { optionArgs } from "../../../../lib/public-cli";
import { AuthMethodCommand } from "../../command";
import type { SchemaTarget } from "../../command";

/** What a run that names no provider is refused for. */
const NAME_PROVIDER_REFUSAL: Refusal = {
  message: "Name the provider to remove",
  hint: "Pass --provider, e.g. --provider {example}. {schema} offers: {offered}.",
};

/**
 * The provider to remove. It is always named, because removing every provider
 * at once would be a different, larger change; the refusal lists the providers
 * the schema offers, well-formed or not.
 */
export function providerToRemove(given: string | undefined, target: SchemaTarget): string {
  if (given !== undefined) {
    return given;
  }
  throw refusalError(NAME_PROVIDER_REFUSAL, {
    example: IDP_PROVIDERS[0],
    schema: target.schema.name,
    offered: listOrNone(listedProviders(target.schema.body)),
  });
}

/** Names joined for a refusal's hint, or `none`. */
function listOrNone(names: readonly string[]): string {
  return names.join(", ") || "none";
}

/** What a provider that nothing offers and no connection names is refused for. */
const UNKNOWN_PROVIDER_REFUSAL: Refusal = {
  code: "E_NOT_FOUND",
  message: "{schema} has no provider named {provider}",
  hint: "{schema} offers: {offered}. Connections under {dir}/: {connections}.",
  details: {
    requested: "{provider}",
    offered: "{offeredList}",
    connections: "{connectionList}",
  },
};

/**
 * The slugs the Project's connection files name: each file's `slug`, or its
 * name when it has none. A file that does not parse goes by its name, so a
 * broken connection does not fail a run that changes nothing.
 */
export async function connectionSlugs(cwd: string): Promise<string[]> {
  const dir = join(cwd, IDPS_DIR);
  const names = (await readDirIfExists(dir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => {
      const body: unknown = await readFile(join(dir, name), "utf8")
        .then((text): unknown => JSON.parse(text))
        .catch(() => undefined);
      const slug = isObject(body) && typeof body.slug === "string" ? body.slug.trim() : "";
      return slug || name.slice(0, -".json".length);
    }),
  );
}

/**
 * Refuse a provider that removing changes nothing for, that the catalog does
 * not list and that no connection names, such as a typo. `sso disable` keeps
 * the connection, so disabling a provider again stays a no-op.
 */
export function refuseUnknownProvider(
  provider: string,
  target: SchemaTarget,
  connections: readonly string[],
): void {
  const known: readonly string[] = IDP_PROVIDERS;
  if (known.includes(provider) || connections.includes(provider)) {
    return;
  }
  const offered = listedProviders(target.schema.body);
  throw refusalError(UNKNOWN_PROVIDER_REFUSAL, {
    schema: target.schema.name,
    provider,
    offered: listOrNone(offered),
    offeredList: offered,
    dir: IDPS_DIR,
    connections: listOrNone(connections),
    connectionList: connections,
  });
}

/**
 * The flows a provider is removed from, once the schema and each flow are in
 * the shapes the editors write: a region that is not what they write is
 * someone's, and is not overwritten.
 */
export function removableFlows(target: SchemaTarget): FlowFile[] {
  refuseUneditable(target.schema.path, ssoEditRefusal(target.schema.body, "schema"));
  for (const flow of target.flows) {
    refuseUneditable(flow.path, ssoProvidersRefusal(flow.body));
  }
  return target.flows;
}

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

  protected async execute({ flags }: Admitted<typeof AuthMethodSsoDisable>): Promise<JsonEnvelope> {
    const target = await this.schemaTarget(flags);
    const provider = providerToRemove(flags.provider, target);
    const flows = removableFlows(target);
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

    if (changed.length === 0) {
      refuseUnknownProvider(provider, target, await connectionSlugs(cwd));
    } else {
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
        ...optionArgs("--schema", schema.schemaFlag),
      ],
      cwdArgs,
    });
    if (permit === undefined) {
      return this.emit({ status: "skipped", reason: "disable-cancelled" });
    }

    // When only a flow still offered the provider, say so: the schema itself
    // did not change.
    const where = schemaChange.changed ? schema.name : `the login flows of ${schema.name}`;
    const unchanged = `${schema.name} does not offer ${provider}, so nothing changed`;
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
        pretty: changed.length > 0 ? `Would remove ${provider} from ${where}` : unchanged,
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
      consola.info(unchanged);
    }
    this.reportOutcome(outcome);
    const followUps = this.followUps(changed.length > 0, cwdArgs);
    return this.emit({
      status: "ok",
      data: { ...data, next_args: followUps.args },
      next: { commands: followUps.commands },
      pretty: changed.length > 0 ? `Removed ${provider} from ${where}` : unchanged,
    });
  }
}
