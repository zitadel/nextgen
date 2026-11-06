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
} from "@/lib/auth-methods";
import { readDirIfExists } from "@/lib/fs";
import {
  connectionLeftover,
  type ConnectionLeftover,
  type FlowFile,
  IDPS_DIR,
  generatedSsoSteps,
  offersProvider,
  readConnectionFiles,
  readFlowFiles,
  readSchemaFiles,
  removeSsoFromFlow,
  removeSsoFromSchema,
  ssoEditRefusal,
  ssoProvidersRefusal,
} from "@/lib/idp";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { isObject, stableStringify } from "@/lib/json";
import { type Admitted, CommandGroups, type JsonEnvelope, nonBlankString } from "@/lib/oclif";
import { ZitadelError } from "@/lib/errors";
import { optionArgs } from "@/lib/public-cli";
import { reportWarning } from "@/lib/warnings";
import { environmentSelectorSuffix } from "@/lib/oclif/environment-flags";
import { projectCommand } from "@/lib/suggestion";
import { AuthMethodCommand } from "@/commands/auth-method/command";
import type { SchemaTarget } from "@/commands/auth-method/command";
import { prose } from "@/lib/oclif/rendering";

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
 * provider again does not ask for them, and the server cannot delete a
 * connection yet anyway. The routes and steps `auth-method sso enable` added
 * stay in the flows too. The result names what was kept and how to remove
 * what can be removed today.
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
      return this.emit({
        status: "skipped",
        reason: "disable-cancelled",
      });
    }

    // After the guards, so a refused or cancelled run reads nothing more.
    const kept =
      changed.length > 0
        ? await this.kept(target, provider, changedFlows)
        : { connection: undefined, steps: [] };

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
      ...(changed.length > 0 ? { kept: keptData(kept) } : {}),
    };
    const actions = this.removalActions(kept, flags);
    const outcome = {
      schema,
      before: schema.body,
      after,
      flowsAfter: flowChanges.map(({ after: body }) => body),
    };

    if (this.dryRun) {
      this.reportOutcome(outcome);
      for (const note of keptNotes(provider, kept, "Would keep")) {
        consola.info(note);
      }

      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data,
        pretty: prose(changed.length > 0 ? `Would remove ${provider} from ${where}` : unchanged),
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
    for (const note of keptNotes(provider, kept, "Kept")) {
      consola.info(note);
    }
    this.reportOutcome(outcome);
    const followUps = this.followUps(changed.length > 0, cwdArgs);

    return this.emit({
      status: "ok",
      data: { ...data, next_args: followUps.args },
      next: { ...(actions.length > 0 ? { actions } : {}), commands: followUps.commands },
      pretty: prose(changed.length > 0 ? `Removed ${provider} from ${where}` : unchanged),
    });
  }

  /**
   * What removing the provider leaves behind: its connection file, unless
   * another schema or flow still offers the provider, and the steps
   * `auth-method sso enable` added to a changed flow that now offers no
   * provider. A connection file that cannot be read is warned about rather
   * than refused: the report is all it would have changed.
   */
  private async kept(
    target: SchemaTarget,
    provider: string,
    flowChanges: ReadonlyArray<{ file: FlowFile; after: Record<string, unknown> }>,
  ): Promise<Kept> {
    const { cwd, schema, flows } = target;
    const mine = new Set(flows.map((flow) => flow.path));
    const usedBy = [
      ...(await readSchemaFiles(cwd))
        .filter((other) => other.path !== schema.path)
        .filter((other) => listedProviders(other.body).includes(provider))
        .map((other) => other.path),
      ...(await readFlowFiles(cwd))
        .filter((flow) => !mine.has(flow.path) && offersProvider(flow.body, provider))
        .map((flow) => flow.path),
    ];
    const files = await readConnectionFiles(cwd).catch((error: unknown) => {
      if (!(error instanceof ZitadelError)) {
        throw error;
      }
      reportWarning(
        `${error.message}, so what is left of the ${provider} connection is not reported.`,
      );
      return undefined;
    });
    const connection = files === undefined ? undefined : connectionLeftover(files, provider);
    return {
      connection:
        connection === undefined
          ? undefined
          : { ...connection, usedBy, reason: usedBy.length > 0 ? "in-use" : "delete-unsupported" },
      steps: flowChanges.flatMap(({ file, after }) => {
        const names = offersProvider(after) ? [] : generatedSsoSteps(after);
        return names.length > 0 ? [{ flow: file.path, steps: names }] : [];
      }),
    };
  }

  /**
   * How to remove the connection, when nothing else offers its provider: the
   * file before the next deploy, and its variables once that deploy is live.
   * In the other order the live release would offer a provider whose
   * credentials are gone, and the deploy would refuse a connection whose
   * variables are missing. The `variable rm` commands carry the run's
   * `--env`/`--env-file`/`--server`, so they reach the project this run named.
   */
  private removalActions(
    kept: Kept,
    flags: { cwd?: string; env?: string; envFile?: string; server?: string },
  ): string[] {
    const { connection } = kept;
    if (connection?.reason !== "delete-unsupported") {
      return [];
    }
    const selector = environmentSelectorSuffix({
      cwd: flags.cwd,
      envFile: flags.envFile,
      envName: flags.env,
      server: flags.server,
    });
    const commands = connection.variables.map((name) =>
      projectCommand(`variable rm ${name}`, selector, this.cliVersion),
    );
    return [
      `To stop publishing the connection, delete ${connection.file} before the deploy below.`,
      ...(commands.length > 0
        ? [
            `Once that deploy is live, remove its credentials: ${commands.map((c) => `\`${c}\``).join(" and ")}`,
          ]
        : []),
    ];
  }
}

/** What `auth-method sso disable` leaves in place. */
type Kept = {
  readonly connection:
    | (ConnectionLeftover & {
        /** Other schemas and flows that still offer the provider. */
        readonly usedBy: string[];
        /** `in-use` while `usedBy` names any; otherwise only the server's missing delete keeps it. */
        readonly reason: "in-use" | "delete-unsupported";
      })
    | undefined;
  readonly steps: ReadonlyArray<{ flow: string; steps: string[] }>;
};

/** The result's `kept`, in the envelope's spelling. */
function keptData(kept: Kept) {
  const { connection } = kept;
  return {
    connection:
      connection === undefined
        ? null
        : {
            file: connection.file,
            variables: connection.variables,
            reason: connection.reason,
            used_by: connection.usedBy,
          },
    steps: kept.steps,
  };
}

/** One line for each thing kept, and why, led by `verb`. */
function keptNotes(provider: string, kept: Kept, verb: "Kept" | "Would keep"): string[] {
  const notes: string[] = [];
  const { connection } = kept;
  if (connection?.reason === "in-use") {
    notes.push(
      `${verb} ${connection.file}: ${provider} is still offered by ${connection.usedBy.join(", ")}.`,
    );
  } else if (connection !== undefined) {
    const variables =
      connection.variables.length > 0
        ? ` and the project variables ${connection.variables.join(" and ")}`
        : "";
    notes.push(
      `${verb} ${connection.file}${variables}, so enabling ${provider} again does not ask for its credentials. ` +
        "Deploys publish the connection until you delete the file; the server keeps it either way, " +
        "as deleting a connection is not supported yet.",
    );
  }
  for (const { flow, steps } of kept.steps) {
    notes.push(
      `${verb} the steps ${steps.join(" and ")} in ${flow} for the next provider you enable.`,
    );
  }
  return notes;
}
