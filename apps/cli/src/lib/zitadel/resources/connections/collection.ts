import { basename } from "node:path";

import { credentialVariables, IDP_PROVIDERS, parseConnectionSlug } from "@zitadel/config/idp";

import { Change, DocumentChange, type Notice } from "@/lib/zitadel/change";
import { Collection } from "@/lib/zitadel/resources/collection";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type {
  ConnectionPath,
  ConnectionSetting,
  CredentialNames,
  CredentialVariable,
  LookupOptions,
  SsoOptions,
  UnusedConnection,
} from "@/lib/zitadel/resources/connections/types";
import { ConfigError, ConflictError, NotFoundError } from "@/lib/zitadel/errors";
import { assertFlowsIntact } from "@/lib/zitadel/rules/flows";
import type { Flow } from "@/lib/zitadel/resources/flows/flow";
import type { SkippedRegion } from "@/lib/zitadel/resources/document";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";
import type { ForceOptions } from "@/lib/zitadel/resources/schemas/types";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

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
   * @param slug - The slug, as a file writes it.
   * @returns The connection, or `undefined` when no file has the slug.
   */
  find(slug: string): Connection | undefined {
    return this.all.find((connection) => {
      return connection.slug === slug;
    });
  }

  /**
   * Resolve the connection already in the project that a new one would be.
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
  resolveExisting(candidate: Connection, options: LookupOptions = {}): Connection | undefined {
    if (candidate.template === undefined) {
      const named = this.resolveBySlug(candidate.name, candidate.issuer);
      if (named !== undefined) {
        named.refuseDifferentClientId(options.clientId);
        this.refuseCollidingVariables(named.credentialNames, candidate.name, named);
      }
      return named;
    }
    const matches = this.filter((connection) => {
      if (connection.template === candidate.template) {
        return true;
      }
      return connection.declares(candidate.name) && connection.issuer === candidate.issuer;
    });
    if (matches.all.length > 1) {
      throw new ConflictError(
        `More than one ${candidate.providerName} connection exists: ${matches.paths.join(", ")}`,
        {
          hint: "Keep the one this Project should use and remove the others, then run the command again.",
          details: { provider: candidate.name, files: matches.paths },
        },
      );
    }
    const match = matches.all[0];
    if (match === undefined) {
      this.refuseTakenFileName(candidate);
      this.refuseCollidingVariables(candidate.credentialNames, candidate.name);
      return undefined;
    }
    match.refuseDifferentClientId(options.clientId);
    // A file can match on its template while carrying no slug of its own.
    // Inventing the provider's would point the schema and every flow at an
    // identity the connection does not declare.
    if (match.validSlug === undefined) {
      throw new ConfigError(
        `${match.path} is a ${candidate.providerName} connection with no usable slug`,
        {
          hint: "Give the connection file a slug: the schemas and flows reference it by that name.",
          details: { file: match.path },
        },
      );
    }
    this.refuseCollidingVariables(match.credentialNames, match.name, match);
    return match;
  }

  /**
   * Resolve the connection a slug names, with everything the slug alone
   * decides refused, so a caller can check a slug the moment it is typed.
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
  resolveBySlug(slug: string, issuer?: string): Connection | undefined {
    const holders = this.filter((connection) => {
      return connection.declares(slug);
    });
    if (holders.all.length > 1) {
      throw new ConflictError(
        `More than one connection is named ${slug}: ${holders.paths.join(", ")}`,
        {
          hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
          details: { slug, files: holders.paths },
        },
      );
    }
    const match = holders.all[0];
    if (match === undefined) {
      this.refuseTakenSlug(slug);
      return undefined;
    }
    if (issuer !== undefined) {
      this.refuseChangedIssuer(match, slug, issuer);
    }
    return match;
  }

  /**
   * Find the connections that reach a candidate's issuer, which a new
   * connection adds a second sign-in button beside.
   *
   * @param candidate - The new connection.
   * @returns Their paths.
   */
  findSameIssuer(candidate: Connection): readonly string[] {
    return this.filter((connection) => {
      return connection.issuer !== undefined && connection.issuer === candidate.issuer;
    }).paths;
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
   * @returns The change, about the connection the schema now lists: the
   *   candidate when it is created, or the one the project already had.
   * @throws {@link NotFoundError} When no flow runs against the schema.
   * @throws {@link ConflictError} When the connection would step on another one.
   * @throws {@link ConfigError} When the connection has no usable slug.
   * @throws {@link RefusedEditError} When a region the edit writes is not the
   *   shape it writes.
   * @throws {@link BrokenFlowsError} When a flow would stop validating.
   */
  enable(
    schema: UserSchema,
    candidate: Connection,
    options: SsoOptions = {},
  ): DocumentChange<Connection> {
    const flows = this.config.flows.resolveForSso(schema);
    const existing = this.resolveExisting(candidate, options);
    const connection = existing ?? candidate;
    const slug = connection.validSlug;
    if (slug === undefined) {
      throw new ConfigError(`${connection.path} has no usable slug`, {
        hint: "Give the connection file a slug: the schemas and flows reference it by that name.",
        details: { file: connection.path },
      });
    }
    const edited = schema.withProvider(slug).document;
    const start = existing === undefined ? this.config.with(candidate) : this.config;
    const flowEdits = flows.map((flow) => {
      return flow.withProvider(slug, schema.enabledMethods);
    });
    const after = flowEdits.reduce((current, flowEdit) => {
      return current.with(flowEdit.document);
    }, start.with(edited));
    const edit = { before: this.config, after, original: schema, edited };
    assertFlowsIntact(edit);
    const skipped = flowEdits.flatMap((flowEdit) => {
      return flowEdit.skipped.map((region) => {
        return this.describeUntouched(flowEdit.document, region, slug);
      });
    });
    const given = options.given ?? [];
    return new DocumentChange({
      before: this.config,
      after,
      document: connection,
      notices: [
        ...this.describeConnection(schema, candidate, existing, given),
        ...skipped,
        ...this.config.schemas.describeSignIn(edit),
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
   * @param slug - The provider, as typed: a typo is refused, not guessed at.
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
    const edited = schema.withoutProvider(slug).document;
    const after = this.config.flows.findForSchema(schema).reduce((current, flow) => {
      return current.with(flow.withoutProvider(slug).document);
    }, this.config.with(edited));
    const edit = { before: this.config, after, original: schema, edited };
    if (after.changedDocuments.length === 0) {
      this.refuseUnknownProvider(schema, slug);
      return new Change({ before: this.config, after });
    }
    assertFlowsIntact(edit);
    this.config.schemas.assertSignInLeft(edit, slug, options.force === true);
    const steps = after.flows
      .findForSchema(edited)
      .filter((flow) => {
        return flow.isUnsaved && !flow.offersSso && flow.generatedSsoSteps.length > 0;
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
        ...after.connections.describeKept(slug),
        ...steps,
        ...this.config.schemas.describeSignIn(edit),
      ],
    });
  }

  /**
   * Find the schemas that list a provider and the flows that offer it.
   *
   * @param slug - The provider.
   * @returns Their paths, schemas first.
   */
  findOfferingPaths(slug: string): readonly string[] {
    const schemas = this.config.schemas.filter((schema) => {
      return schema.lists(slug);
    });
    const flows = this.config.flows.filter((flow) => {
      return flow.offers(slug);
    });
    return [...schemas.paths, ...flows.paths];
  }

  /**
   * Find the variables a connection's credentials read that no other
   * connection reads, so removing them breaks nothing else.
   *
   * @param connection - The connection.
   * @returns The variable names.
   */
  findUnsharedVariables(connection: Connection): readonly CredentialVariable[] {
    const elsewhere: readonly string[] = this.all
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
   * Find the connection a provider leaves behind once no schema lists it and
   * no flow offers it, with the variables only it reads.
   *
   * @remarks
   * Asked of the collection after a provider is removed, so what still
   * offers the provider is what the removal leaves.
   *
   * @param slug - The provider.
   * @returns The connection and its variables, or `undefined` when no file
   *   has the provider or something still offers it.
   */
  findUnused(slug: string): UnusedConnection | undefined {
    const connection = this.find(slug);
    if (connection === undefined || this.findOfferingPaths(slug).length > 0) {
      return undefined;
    }
    return { connection, variables: this.findUnsharedVariables(connection) };
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
   * Describe the connection a provider is enabled with: a second connection
   * to one issuer, settings an existing file does not have, and a new
   * connection's claim mapping.
   *
   * @param schema - The schema.
   * @param candidate - The connection that would be written.
   * @param existing - The connection reused instead, if any.
   * @param given - The settings the developer gave.
   * @returns The notices.
   */
  private describeConnection(
    schema: UserSchema,
    candidate: Connection,
    existing: Connection | undefined,
    given: readonly ConnectionSetting[],
  ): readonly Notice[] {
    if (existing !== undefined) {
      return this.describeUnapplied(existing, candidate, given);
    }
    const provider = candidate.providerName;
    const others = this.findSameIssuer(candidate);
    const secondButton: readonly Notice[] =
      candidate.template !== undefined && others.length > 0
        ? [
            {
              severity: "warning",
              message: `${others.join(", ")} already connects to ${provider}'s issuer under another slug, so this adds a second ${provider} connection and button.`,
            },
          ]
        : [];
    // `deploy` refuses a connection that fills nothing, so it is said now.
    const fillsNothing: readonly Notice[] =
      candidate.mappings.length === 0
        ? [
            {
              severity: "warning",
              message:
                `${schema.path} defines none of the properties ${provider} maps by default, so ${candidate.path} has no claim_mapping ` +
                `and no sign-in can fill a user. Add the properties your provider returns to claim_mapping in ${candidate.path}.`,
            },
          ]
        : [];
    const summary: readonly Notice[] =
      candidate.template === undefined && candidate.mappings.length > 0
        ? [{ severity: "info", message: candidate.mappingSummary }]
        : [];
    return [...secondButton, ...fillsNothing, ...summary];
  }

  /**
   * Describe the settings a reused connection does not apply.
   *
   * @param existing - The connection reused.
   * @param candidate - The connection the settings would have written.
   * @param given - The settings the developer gave.
   * @returns One warning naming them, or none when every one applies.
   */
  private describeUnapplied(
    existing: Connection,
    candidate: Connection,
    given: readonly ConnectionSetting[],
  ): readonly Notice[] {
    const unapplied = existing.listUnappliedSettings(candidate, given);
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

  /**
   * Describe the connection file a removed provider leaves: still in use
   * elsewhere, or kept only because the server cannot delete it yet.
   *
   * @remarks
   * Asked of the collection after the change, so what still offers the
   * provider is what the change leaves.
   *
   * @param slug - The provider.
   * @returns The notices; none when no file has the provider.
   */
  private describeKept(slug: string): readonly Notice[] {
    const unused = this.findUnused(slug);
    if (unused === undefined) {
      const connection = this.find(slug);
      if (connection === undefined) {
        return [];
      }
      const offering = this.findOfferingPaths(slug).join(", ");
      return [
        {
          severity: "info",
          message: `${connection.path} stays: ${slug} is still offered by ${offering}.`,
        },
      ];
    }
    const { connection, variables } = unused;
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
    const inCatalog = IDP_PROVIDERS.some((provider) => {
      return provider === slug;
    });
    const connections = this.all.map((connection) => {
      return connection.name;
    });
    if (inCatalog || connections.includes(slug)) {
      return;
    }
    const offered = schema.providers;
    const offeredList = offered.join(", ") || "none";
    const connectionList = connections.join(", ") || "none";
    throw new NotFoundError(`${schema.name} has no provider named ${slug}`, {
      hint: `${schema.name} offers: ${offeredList}. Connections under ${CONFIG_DIRECTORIES.connections}/: ${connectionList}.`,
      details: { requested: slug, offered, connections },
    });
  }

  /**
   * Describe a region of a flow the edit left alone because it was edited by
   * hand, and what to do about it.
   *
   * @param flow - The flow.
   * @param region - The region.
   * @param slug - The provider being added.
   * @returns The notice.
   */
  private describeUntouched(flow: Flow, region: SkippedRegion, slug: string): Notice {
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
   * Refuse a slug no connection has yet, when its file name is another
   * connection's or the variables it derives are: writing a connection under it
   * would replace that file or overwrite those credentials.
   *
   * @param slug - The slug.
   * @throws {@link ConflictError} When it is taken either way.
   */
  private refuseTakenSlug(slug: string): void {
    const name = `${slug}.json`;
    const taken = this.all.some((connection) => {
      return basename(connection.path) === name;
    });
    if (taken) {
      const path: ConnectionPath = `${CONFIG_DIRECTORIES.connections}/${slug}.json`;
      throw new ConflictError(`${path} already exists and is not the ${slug} connection`, {
        hint: "Rename or remove that file, or choose another slug, then run the command again.",
        details: { file: path, slug },
      });
    }
    const parsed = parseConnectionSlug(slug);
    if (parsed.ok) {
      this.refuseCollidingVariables(credentialVariables(parsed.value), slug);
    }
  }

  /**
   * Refuse a new connection whose file name another connection already has:
   * writing it would replace that one.
   *
   * @param candidate - The new connection.
   * @throws {@link ConflictError} When the name is taken.
   */
  private refuseTakenFileName(candidate: Connection): void {
    const occupied = this.all.find((connection) => {
      return basename(connection.path) === basename(candidate.path);
    });
    if (occupied === undefined) {
      return;
    }
    if (occupied.declares(candidate.name)) {
      const issuer = candidate.issuer ?? "the same";
      throw new ConflictError(
        `${candidate.path} is a connection called ${candidate.name}, but not to ${candidate.providerName}: its issuer is not ${issuer}`,
        {
          hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
          details: { file: candidate.path, slug: candidate.name },
        },
      );
    }
    throw new ConflictError(
      `${candidate.path} already exists and is not the ${candidate.name} connection`,
      {
        hint: "Rename or remove that file, or choose another slug, then run the command again.",
        details: { file: candidate.path, slug: occupied.slug ?? null },
      },
    );
  }

  /**
   * Refuse an issuer other than the one an existing connection was written
   * with. An applied connection keeps its issuer, and the server compares it
   * exactly.
   *
   * @param connection - The existing connection.
   * @param slug - Its slug.
   * @param issuer - The issuer the developer gave.
   * @throws {@link ConflictError} When they differ.
   */
  private refuseChangedIssuer(connection: Connection, slug: string, issuer: string): void {
    if (connection.issuer === issuer) {
      return;
    }
    const found =
      connection.issuer === undefined
        ? `is not an OIDC connection to ${issuer}`
        : `connects to ${connection.issuer}, not ${issuer}`;
    throw new ConflictError(`${connection.path} is already named ${slug} and ${found}`, {
      hint:
        "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. " +
        "Choose another slug for this connection, then move the schemas and flows that name the old one to it.",
      details: {
        file: connection.path,
        slug,
        issuer,
        existing_issuer: connection.issuer ?? null,
      },
    });
  }

  /**
   * Refuse credentials that would land in another connection's variable, or
   * both in one. A publish would overwrite what the other credential put there,
   * and the loser signs in with the wrong application, which surfaces at the
   * provider and not here.
   *
   * @param ours - The variables this connection reads.
   * @param slug - Its slug.
   * @param except - The connection being reused, which is not its own collision.
   * @throws {@link ConflictError} When a variable is shared.
   */
  private refuseCollidingVariables(ours: CredentialNames, slug: string, except?: Connection): void {
    // The two are branded apart, so they are compared as the names they both are.
    const clientId: string | undefined = ours.clientId;
    const clientSecret: string | undefined = ours.clientSecret;
    if (clientId !== undefined && clientId === clientSecret) {
      throw new ConflictError(`This connection points both credentials at ${clientId}`, {
        hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
        details: { slug, variable: clientId },
      });
    }
    const names = [ours.clientId, ours.clientSecret].filter((name): name is CredentialVariable => {
      return name !== undefined;
    });
    const others = this.all.filter((connection) => {
      return connection !== except;
    });
    for (const connection of others) {
      const shared = names.find((name) => {
        return connection.variableNames.includes(name);
      });
      if (shared !== undefined) {
        throw new ConflictError(`${connection.path} and ${slug} both use ${shared}`, {
          hint: "Point one of them at a variable of its own, then run the command again.",
          details: { file: connection.path, slug, other_slug: connection.name, variable: shared },
        });
      }
    }
  }
}
