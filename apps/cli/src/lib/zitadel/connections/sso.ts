/**
 * Offering a connection's provider as a way to sign in, and taking it away
 * again: the connection file, the user schema's `sso` providers, and the steps
 * and routes of every login flow that runs against the schema, as one change.
 */

import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { Change } from "@/lib/zitadel/change";
import type { ZitadelConfig } from "@/lib/zitadel/config";
import type { Connection } from "@/lib/zitadel/connections/connection";
import {
  type ConnectionSetting,
  existingConnection,
  type LookupOptions,
  sameIssuer,
  unappliedSettings,
} from "@/lib/zitadel/connections/lookup";
import { ConfigError, NotFoundError } from "@/lib/zitadel/errors";
import { assertFlowsIntact } from "@/lib/zitadel/flows/checks";
import type { Flow } from "@/lib/zitadel/flows/flow";
import type { ForceOptions } from "@/lib/zitadel/schemas/methods";
import type { UserSchema } from "@/lib/zitadel/schemas/schema";
import { assertSignInLeft, signInNotices } from "@/lib/zitadel/schemas/signin";
import { CONFIG_DIRECTORIES, type Notice, type SkippedRegion } from "@/lib/zitadel/types";

/** What enabling a provider is told beyond the connection itself. */
export type SsoOptions = LookupOptions &
  Readonly<{
    /** The settings the developer gave, which an existing connection may not have. */
    given?: readonly ConnectionSetting[] | undefined;
  }>;

/**
 * The login flows a provider is offered on, with the schema and each flow
 * checked first for a region the edit could not write, so a caller can refuse
 * before it asks anything.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @returns The flows that run against it.
 * @throws {@link NotFoundError} When no flow runs against the schema: a
 *   provider no flow offers is no sign-in button at all.
 * @throws {@link RefusedEditError} When a region the edit writes is not the
 *   shape it writes.
 */
export function ssoFlows(config: ZitadelConfig, schema: UserSchema): readonly Flow[] {
  schema.refuseUneditable(schema.editRefusal());
  const flows = config.flowsFor(schema);
  if (flows.length === 0) {
    throw new NotFoundError(`No login flow runs against ${schema.name}`, {
      hint:
        "The provider is offered by a flow, and none of the files under .zitadel/flows/ " +
        "names this schema. Check that the flow's user_schema names the schema's objectType.",
      details: { schema: schema.path },
    });
  }
  for (const flow of flows) {
    flow.refuseUneditable(flow.editRefusal());
  }
  return flows;
}

/**
 * Offer a provider on a user schema: the connection is written unless the
 * project already has it, the schema lists it, and every flow that runs
 * against the schema offers it on its entry steps, with the steps and routes a
 * provider round trip needs. Regions edited by hand are left alone and said.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @param candidate - The connection to write when the project has none for the provider.
 * @param options - What is known beyond the connection.
 * @returns The change.
 * @throws {@link NotFoundError} When no flow runs against the schema.
 * @throws {@link ConflictError} When the connection would step on another one.
 * @throws {@link RefusedEditError} When a region the edit writes is not the
 *   shape it writes.
 * @throws {@link BrokenFlowsError} When a flow would stop validating.
 */
export function enableSso(
  config: ZitadelConfig,
  schema: UserSchema,
  candidate: Connection,
  options: SsoOptions = {},
): Change {
  const flows = ssoFlows(config, schema);
  const existing = existingConnection(config.connections, candidate, options);
  const connection = existing ?? candidate;
  const slug = connection.validSlug;
  if (slug === undefined) {
    throw new ConfigError(`${connection.path} has no usable slug`, {
      hint: "Give the connection file a slug: the schemas and flows reference it by that name.",
      details: { file: connection.path },
    });
  }
  const edited = schema.withProvider(slug);
  const edits = flows.map((flow) => {
    return flow.withProvider(slug, schema.enabledMethods);
  });
  const start = existing === undefined ? config.with(candidate) : config;
  const after = edits.reduce((current, edit) => {
    return current.with(edit.flow);
  }, start.with(edited));
  const edit = { before: config, after, original: schema, edited };
  assertFlowsIntact(edit);
  const skipped = edits.flatMap((flowEdit) => {
    return flowEdit.skipped.map((region) => {
      return untouchedNotice(flowEdit.flow, region, slug);
    });
  });
  return new Change({
    before: config,
    after,
    notices: [
      ...connectionNotices(config, schema, candidate, existing, options.given ?? []),
      ...skipped,
      ...signInNotices(edit),
    ],
  });
}

/**
 * Stop offering a provider on a user schema: the schema no longer lists it,
 * and no flow that runs against the schema offers it. The connection file
 * stays, so enabling the provider again does not ask for its credentials, and
 * so do the steps the provider's sign-in used.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @param slug - The provider.
 * @param options - Whether to leave the schema with no way to sign in.
 * @returns The change.
 * @throws {@link NotFoundError} When nothing offers the provider and no
 *   connection or catalog entry has its name, such as a typo.
 * @throws {@link RefusedEditError} When a region the edit writes is not the
 *   shape it writes.
 * @throws {@link BrokenFlowsError} When a flow would stop validating.
 * @throws {@link NoSignInLeftError} When it is the last way to sign in and
 *   `force` is not set.
 */
export function disableSso(
  config: ZitadelConfig,
  schema: UserSchema,
  slug: string,
  options: ForceOptions = {},
): Change {
  const edited = schema.withoutProvider(slug);
  const after = config.flowsFor(schema).reduce((current, flow) => {
    return current.with(flow.withoutProvider(slug));
  }, config.with(edited));
  const edit = { before: config, after, original: schema, edited };
  if (after.changedDocuments.length === 0) {
    refuseUnknownProvider(config, schema, slug);
    return new Change({ before: config, after });
  }
  assertFlowsIntact(edit);
  assertSignInLeft(edit, slug, options.force === true);
  const idle = after.flowsFor(edited).filter((flow) => {
    return flow.changed && !flow.offers() && flow.generatedSsoSteps.length > 0;
  });
  const steps = idle.map((flow): Notice => {
    return {
      severity: "info",
      message: `The steps ${flow.generatedSsoSteps.join(" and ")} stay in ${flow.path} for the next provider you enable.`,
    };
  });
  return new Change({
    before: config,
    after,
    notices: [...keptConnectionNotices(after, slug), ...steps, ...signInNotices(edit)],
  });
}

/**
 * What to say about the connection a provider is enabled with: a second
 * connection to one issuer, settings an existing file does not have, and a new
 * connection's claim mapping.
 *
 * @param config - The configuration before the change.
 * @param schema - The schema.
 * @param candidate - The connection that would be written.
 * @param existing - The connection reused instead, if any.
 * @param given - The settings the developer gave.
 * @returns The notices.
 */
function connectionNotices(
  config: ZitadelConfig,
  schema: UserSchema,
  candidate: Connection,
  existing: Connection | undefined,
  given: readonly ConnectionSetting[],
): readonly Notice[] {
  const provider = candidate.displayName ?? candidate.name;
  if (existing !== undefined) {
    const unapplied = unappliedSettings(existing, candidate, given);
    if (unapplied.length === 0) {
      return [];
    }
    const settings = unapplied.join(" and ");
    if (unapplied.length === 1) {
      return [
        {
          severity: "warning",
          message: `${existing.path} already exists, so the ${settings} you gave was not applied. Edit the file to change it.`,
        },
      ];
    }
    return [
      {
        severity: "warning",
        message: `${existing.path} already exists, so the ${settings} you gave were not applied. Edit the file to change them.`,
      },
    ];
  }
  const notices: Notice[] = [];
  const others = sameIssuer(config.connections, candidate);
  if (candidate.template !== undefined && others.length > 0) {
    notices.push({
      severity: "warning",
      message: `${others.join(", ")} already connects to ${provider}'s issuer under another slug, so this adds a second ${provider} connection and button.`,
    });
  }
  if (candidate.mappings.length === 0) {
    // `deploy` refuses a connection that fills nothing, so it is said now.
    notices.push({
      severity: "warning",
      message:
        `${schema.path} defines none of the properties ${provider} maps by default, so ${candidate.path} has no claim_mapping ` +
        `and no sign-in can fill a user. Add the properties your provider returns to claim_mapping in ${candidate.path}.`,
    });
  }
  if (candidate.template === undefined && candidate.mappings.length > 0) {
    notices.push({ severity: "info", message: mappingSummary(candidate, provider) });
  }
  return notices;
}

/**
 * The claim mappings a connection of the developer's own was written with:
 * which side of each line is their schema's and which the claim the provider
 * must return, then what verifies a value, which a mapping alone does not.
 *
 * @param connection - The connection.
 * @param provider - The provider's name.
 * @returns The summary, one line per row.
 */
function mappingSummary(connection: Connection, provider: string): string {
  const mappings = connection.mappings.map(({ property, claim }) => {
    return `  ${property} ← ${String(claim)}`;
  });
  const verifications = connection.verifications.map(({ property, claim }) => {
    if (claim === true) {
      return `  ${property} is treated as verified.`;
    }
    return `  ${property} is treated as verified only when ${provider} says so in the ${String(claim)} claim.`;
  });
  const verification =
    verifications.length === 0
      ? ["Nothing is treated as verified."]
      : ["Verification, which a mapping alone does not give:", ...verifications];
  return [
    `Claim mappings in ${connection.path}. Each line is an attribute of your user schema, then the claim ${provider} must return for it:`,
    ...mappings,
    ...verification,
    "Edit the mappings in that file if your provider returns other claims.",
  ].join("\n");
}

/**
 * What to say about a region of a flow the edit left alone because it was
 * edited by hand, and what to do about it.
 *
 * @param flow - The flow.
 * @param region - The region.
 * @param slug - The provider being added.
 * @returns The notice.
 */
function untouchedNotice(flow: Flow, region: SkippedRegion, slug: string): Notice {
  const lead = `${flow.path} ${region.region} has been edited by hand, so it was left alone.`;
  if (region.step === "password") {
    return {
      severity: "warning",
      message:
        `${lead} Add ${slug} to its sso_providers, and route sso_authenticated to the step a sign-in ends on, ` +
        "sso_user_not_found to register-sso and user_already_exists to sso-conflict.",
    };
  }
  if (region.step === "sso-conflict") {
    return { severity: "warning", message: `${lead} Add ${slug} to its sso_providers.` };
  }
  return { severity: "warning", message: `${lead} Update it yourself.` };
}

/**
 * What to say about the connection file a removed provider leaves: still in
 * use elsewhere, or kept only because the server cannot delete it yet.
 *
 * @param after - The configuration after the change.
 * @param slug - The provider.
 * @returns The notices; none when no file has the provider.
 */
function keptConnectionNotices(after: ZitadelConfig, slug: string): readonly Notice[] {
  const connection = after.connection(slug);
  if (connection === undefined) {
    return [];
  }
  const usedBy = after.offeredBy(slug);
  if (usedBy.length > 0) {
    return [
      {
        severity: "info",
        message: `${connection.path} stays: ${slug} is still offered by ${usedBy.join(", ")}.`,
      },
    ];
  }
  const variables = after.unsharedVariables(connection);
  const kept =
    variables.length > 0
      ? `${connection.path} and the project variables ${variables.join(" and ")}`
      : connection.path;
  return [
    {
      severity: "info",
      message:
        `${kept} stay, so enabling ${slug} again does not ask for its credentials. ` +
        "Deploys publish the connection until you delete the file; the server keeps it either way, " +
        "as deleting a connection is not supported yet.",
    },
  ];
}

/**
 * Refuse a provider that removing changes nothing for, that the catalog does
 * not list and that no connection names, such as a typo. Disabling a provider
 * again stays a no-op.
 *
 * @param config - The configuration.
 * @param schema - The schema.
 * @param slug - The provider.
 * @throws {@link NotFoundError} When nothing knows the provider.
 */
function refuseUnknownProvider(config: ZitadelConfig, schema: UserSchema, slug: string): void {
  const catalog: readonly string[] = IDP_PROVIDERS;
  const connections = config.connections.map((connection) => {
    return connection.name;
  });
  if (catalog.includes(slug) || connections.includes(slug)) {
    return;
  }
  const offered = schema.providers;
  throw new NotFoundError(`${schema.name} has no provider named ${slug}`, {
    hint: `${schema.name} offers: ${offered.join(", ") || "none"}. Connections under ${CONFIG_DIRECTORIES.connections}/: ${connections.join(", ") || "none"}.`,
    details: { requested: slug, offered, connections },
  });
}
