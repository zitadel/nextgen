import { IDP_PROVIDERS } from "@zitadel/config/idp";

import { Change, type Notice } from "@/lib/zitadel/change";
import { Collection } from "@/lib/zitadel/resources/collection";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import {
  type ConnectionSetting,
  type LookupOptions,
  paths,
  pathOf,
  refuseChangedIssuer,
  refuseCollidingVariables,
  refuseDifferentClientId,
  refuseTakenFileName,
  refuseTakenSlug,
  sameIssuer,
  unappliedSettings,
} from "@/lib/zitadel/resources/connections/lookup";
import { ConfigError, ConflictError, NotFoundError } from "@/lib/zitadel/errors";
import { assertFlowsIntact } from "@/lib/zitadel/resources/flows/checks";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { SkippedRegion } from "@/lib/zitadel/resources/flows/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ForceOptions } from "@/lib/zitadel/resources/schemas/types";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

/**
 * What enabling a provider is told beyond the connection itself.
 */
export type SsoOptions = LookupOptions &
  Readonly<{
    /**
     * The settings the developer gave, which an existing connection may not
     * have.
     */
    given?: readonly ConnectionSetting[] | undefined;
  }>;

/**
 * The identity-provider connections under `.zitadel/idps/`, in path order,
 * and offering one as a way to sign in.
 *
 * @remarks
 * Anything ambiguous about which connection is meant is refused instead of
 * guessed: editing the wrong connection, or silently adding a duplicate, are
 * both worse than asking which was meant.
 */
export class Connections extends Collection<Connection> {
  /**
   * The connection a slug names: the first file in path order that has it,
   * so two files claiming one slug do not both stand for it.
   *
   * @param slug - The slug.
   * @returns The connection, or `undefined` when no file has the slug.
   */
  find(slug: string): Connection | undefined {
    return this.all.find((connection) => {
      return connection.slug === slug;
    });
  }

  /**
   * The connection already in the project that a new one would be.
   *
   * @remarks
   * A connection from the catalog is found by what it is: its `template`, or
   * its slug and issuer. One of the developer's own is found by its slug,
   * because a project may hold several connections to one issuer and the
   * name is the only thing that tells them apart.
   *
   * @param candidate - The connection that would be written.
   * @param options - What is known beyond the file.
   * @returns The existing connection, or `undefined` when it is new.
   * @throws {@link ConflictError} When more than one connection could be it,
   *   its file name or slug is taken, its variables are another connection's,
   *   or an existing one of the developer's own connects to another issuer.
   * @throws {@link ConfigError} When the existing one has no usable slug or
   *   holds another client id.
   */
  existing(candidate: Connection, options: LookupOptions = {}): Connection | undefined {
    if (candidate.template === undefined) {
      const named = this.named(candidate.name, candidate.issuer);
      if (named !== undefined) {
        refuseDifferentClientId(named, options.clientId);
        refuseCollidingVariables(this.all, named.credentialNames, candidate.name, named);
      }
      return named;
    }
    const matches = this.all.filter((connection) => {
      if (connection.template === candidate.template) {
        return true;
      }
      return connection.declares(candidate.name) && connection.issuer === candidate.issuer;
    });
    const [match, ...others] = matches;
    if (others.length > 0) {
      throw new ConflictError(
        `More than one ${candidate.displayName ?? candidate.name} connection exists: ${paths(matches)}`,
        {
          hint: "Keep the one this Project should use and remove the others, then run the command again.",
          details: { provider: candidate.name, files: matches.map(pathOf) },
        },
      );
    }
    if (match === undefined) {
      refuseTakenFileName(this.all, candidate);
      refuseCollidingVariables(this.all, candidate.credentialNames, candidate.name);
      return undefined;
    }
    refuseDifferentClientId(match, options.clientId);
    // A file can match on its template while carrying no slug of its own.
    // Inventing the provider's would point the schema and every flow at an
    // identity the connection does not declare.
    if (match.validSlug === undefined) {
      throw new ConfigError(
        `${match.path} is a ${candidate.displayName ?? candidate.name} connection with no usable slug`,
        {
          hint: "Give the connection file a slug: the schemas and flows reference it by that name.",
          details: { file: match.path },
        },
      );
    }
    refuseCollidingVariables(this.all, match.credentialNames, match.name, match);
    return match;
  }

  /**
   * The connection a slug names, with everything the slug alone decides
   * refused, so a caller can check a slug the moment it is typed.
   *
   * @remarks
   * For a connection of the developer's own, whose slug is known before
   * anything else about it.
   *
   * @param slug - The slug.
   * @param issuer - The issuer the developer gave, which an existing
   *   connection with another issuer contradicts.
   * @returns The connection, or `undefined` when the slug is free.
   * @throws {@link ConflictError} When more than one connection has the slug,
   *   the file it would take holds another connection, its variables are
   *   another connection's, or an existing one connects to another issuer.
   */
  named(slug: string, issuer?: string): Connection | undefined {
    const holders = this.all.filter((connection) => {
      return connection.declares(slug);
    });
    const [match, ...others] = holders;
    if (others.length > 0) {
      throw new ConflictError(`More than one connection is named ${slug}: ${paths(holders)}`, {
        hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
        details: { slug, files: holders.map(pathOf) },
      });
    }
    if (match === undefined) {
      refuseTakenSlug(this.all, slug);
      return undefined;
    }
    if (issuer !== undefined) {
      refuseChangedIssuer(match, slug, issuer);
    }
    return match;
  }

  /**
   * Offer a connection's provider as a way to sign in to a user schema.
   *
   * @remarks
   * The connection is written unless the project already has it, the schema
   * lists it, and every flow that runs against the schema offers it on its
   * entry steps, with the steps and routes a provider round trip needs.
   * Regions edited by hand are left alone and said.
   *
   * @param schema - The schema.
   * @param candidate - The connection to write when the project has none for
   *   the provider.
   * @param options - What is known beyond the connection.
   * @returns The change.
   * @throws {@link NotFoundError} When no flow runs against the schema.
   * @throws {@link ConflictError} When the connection would step on another one.
   * @throws {@link ConfigError} When the connection has no usable slug.
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes.
   * @throws {@link BrokenFlowsError} When a flow would stop validating.
   */
  enable(schema: UserSchema, candidate: Connection, options: SsoOptions = {}): Change {
    const flows = this.config.flows.forSso(schema);
    const existing = this.existing(candidate, options);
    const connection = existing ?? candidate;
    const slug = connection.validSlug;
    if (slug === undefined) {
      throw new ConfigError(`${connection.path} has no usable slug`, {
        hint: "Give the connection file a slug: the schemas and flows reference it by that name.",
        details: { file: connection.path },
      });
    }
    const edited = schema.withProvider(slug);
    const start = existing === undefined ? this.config.with(candidate) : this.config;
    const after = flows.reduce((current, flow) => {
      return current.with(flow.withProvider(slug, schema.enabledMethods));
    }, start.with(edited));
    const edit = { before: this.config, after, original: schema, edited };
    assertFlowsIntact(edit);
    const skipped = flows.flatMap((flow) => {
      return flow.regionsLeftAlone(slug, schema.enabledMethods).map((region) => {
        return untouchedNotice(flow, region, slug);
      });
    });
    return new Change({
      before: this.config,
      after,
      notices: [
        ...this.connectionNotices(schema, candidate, existing, options.given ?? []),
        ...skipped,
        ...this.config.schemas.signInNotices(edit),
      ],
    });
  }

  /**
   * Stop offering a provider as a way to sign in to a user schema.
   *
   * @remarks
   * The schema no longer lists it, and no flow that runs against the schema
   * offers it. The connection file stays, so enabling the provider again does
   * not ask for its credentials, and so do the steps the provider's sign-in
   * used. Disabling a provider again is a no-op.
   *
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
  disable(schema: UserSchema, slug: string, options: ForceOptions = {}): Change {
    const edited = schema.withoutProvider(slug);
    const after = this.config.flows.for(schema).reduce((current, flow) => {
      return current.with(flow.withoutProvider(slug));
    }, this.config.with(edited));
    const edit = { before: this.config, after, original: schema, edited };
    if (after.changedDocuments.length === 0) {
      this.refuseUnknownProvider(schema, slug);
      return new Change({ before: this.config, after });
    }
    assertFlowsIntact(edit);
    this.config.schemas.assertSignInLeft(edit, slug, options.force === true);
    const steps = after.flows
      .for(edited)
      .filter((flow) => {
        return flow.changed && !flow.offers() && flow.generatedSsoSteps.length > 0;
      })
      .map((flow): Notice => {
        return {
          severity: "info",
          message: `The steps ${flow.generatedSsoSteps.join(" and ")} stay in ${flow.path} for the next provider you enable.`,
        };
      });
    return new Change({
      before: this.config,
      after,
      notices: [
        ...after.connections.keptNotices(slug),
        ...steps,
        ...this.config.schemas.signInNotices(edit),
      ],
    });
  }

  /**
   * The schemas that list a provider and the flows that offer it.
   *
   * @param slug - The provider.
   * @returns Their paths, schemas first.
   */
  offeredBy(slug: string): readonly string[] {
    const flows = this.config.flows.all.filter((flow) => {
      return flow.offers(slug);
    });
    return [...this.config.schemas.listing(slug), ...flows].map((document) => {
      return document.path;
    });
  }

  /**
   * The variables a connection's credentials read that no other connection
   * reads, so removing them breaks nothing else.
   *
   * @param connection - The connection.
   * @returns The variable names.
   */
  unsharedVariables(connection: Connection): readonly string[] {
    const elsewhere = this.all
      .filter((other) => {
        return other.path !== connection.path;
      })
      .flatMap((other) => {
        return other.variableNames;
      });
    return connection.variableNames.filter((name) => {
      return !elsewhere.includes(name);
    });
  }

  /**
   * Whether the server is known to have a connection already.
   *
   * @param slug - The connection's slug.
   * @returns True only when the caller said it is deployed.
   */
  isDeployed(slug: string): boolean {
    return this.config.options.deployed?.has(slug) === true;
  }

  /**
   * What to say about the connection a provider is enabled with: a second
   * connection to one issuer, settings an existing file does not have, and a
   * new connection's claim mapping.
   *
   * @param schema - The schema.
   * @param candidate - The connection that would be written.
   * @param existing - The connection reused instead, if any.
   * @param given - The settings the developer gave.
   * @returns The notices.
   */
  private connectionNotices(
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
    const others = sameIssuer(this.all, candidate);
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
   * What to say about the connection file a removed provider leaves: still
   * in use elsewhere, or kept only because the server cannot delete it yet.
   *
   * @remarks
   * Asked of the collection after the change, so what still offers the
   * provider is what the change leaves.
   *
   * @param slug - The provider.
   * @returns The notices; none when no file has the provider.
   */
  private keptNotices(slug: string): readonly Notice[] {
    const connection = this.find(slug);
    if (connection === undefined) {
      return [];
    }
    const usedBy = this.offeredBy(slug);
    if (usedBy.length > 0) {
      return [
        {
          severity: "info",
          message: `${connection.path} stays: ${slug} is still offered by ${usedBy.join(", ")}.`,
        },
      ];
    }
    const variables = this.unsharedVariables(connection);
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
   * Refuse a provider that removing changes nothing for, that the catalog
   * does not list and that no connection names, such as a typo.
   *
   * @remarks
   * A provider the catalog or a connection knows is let through, so disabling
   * a provider again stays a no-op.
   *
   * @param schema - The schema.
   * @param slug - The provider.
   * @throws {@link NotFoundError} When nothing knows the provider.
   */
  private refuseUnknownProvider(schema: UserSchema, slug: string): void {
    const catalog: readonly string[] = IDP_PROVIDERS;
    const connections = this.all.map((connection) => {
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
