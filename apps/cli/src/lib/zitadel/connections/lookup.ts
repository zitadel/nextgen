/**
 * Finding the connection a provider already has in a project, and refusing
 * what would make two connections step on each other. Anything ambiguous is
 * refused instead of guessed: editing the wrong connection, or silently adding
 * a duplicate, are both worse than asking which was meant.
 */

import { basename } from "node:path";

import { isVariableReference } from "@zitadel/config/idp";

import type { Connection, CredentialNames } from "@/lib/zitadel/connections/connection";
import { ConfigError, ConflictError } from "@/lib/zitadel/errors";

/** A setting the developer gave for a connection, which an existing file may not have. */
export type ConnectionSetting = "display name" | "scopes";

/** What is known about a connection beyond its file. */
export type LookupOptions = Readonly<{
  /** The client id the developer gave, which an existing file holding another one contradicts. */
  clientId?: string | undefined;
}>;

/**
 * The connection already in the project that a new one would be, or
 * `undefined` when it is new.
 *
 * A connection from the catalog is found by what it is: its `template`, or its
 * slug and issuer. One of the developer's own is found by its slug, because a
 * project may hold several connections to one issuer and the name is the only
 * thing that tells them apart.
 *
 * @param connections - The project's connections.
 * @param candidate - The connection that would be written.
 * @param options - What is known beyond the file.
 * @returns The existing connection, or `undefined`.
 * @throws {@link ConflictError} When more than one connection could be it, its
 *   file name is taken, or its variables are another connection's.
 * @throws {@link ConfigError} When the existing one has no usable slug or holds
 *   another client id.
 */
export function existingConnection(
  connections: readonly Connection[],
  candidate: Connection,
  options: LookupOptions = {},
): Connection | undefined {
  if (candidate.template === undefined) {
    return existingCustomConnection(connections, candidate, options);
  }
  const matches = connections.filter((connection) => {
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
  if (match !== undefined) {
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
    refuseCollidingVariables(connections, match.credentialNames, match.name, match);
    return match;
  }
  refuseTakenFileName(connections, candidate);
  refuseCollidingVariables(connections, candidate.credentialNames, candidate.name);
  return undefined;
}

/**
 * The connection a slug names, for a connection of the developer's own whose
 * slug is known before anything else about it. Everything the slug alone
 * decides is refused here, so a command can raise it the moment the slug is
 * typed.
 *
 * @param connections - The project's connections.
 * @param slug - The slug.
 * @param issuer - The issuer the developer gave, which an existing connection
 *   with another issuer contradicts.
 * @returns The connection, or `undefined` when the slug is free.
 * @throws {@link ConflictError} When more than one connection has the slug,
 *   the file it would take holds another connection, its variables are another
 *   connection's, or an existing one connects to another issuer.
 */
export function connectionNamed(
  connections: readonly Connection[],
  slug: string,
  issuer?: string,
): Connection | undefined {
  const holders = connections.filter((connection) => {
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
    return undefined;
  }
  if (issuer !== undefined) {
    refuseChangedIssuer(match, slug, issuer);
  }
  return match;
}

/**
 * The connections that reach a candidate's issuer under another slug, which a
 * new connection adds a second sign-in button beside.
 *
 * @param connections - The project's connections.
 * @param candidate - The new connection.
 * @returns Their paths.
 */
export function sameIssuer(
  connections: readonly Connection[],
  candidate: Connection,
): readonly string[] {
  return connections
    .filter((connection) => {
      return connection.issuer !== undefined && connection.issuer === candidate.issuer;
    })
    .map(pathOf);
}

/**
 * The settings the developer gave that an existing connection does not have,
 * which reusing it does not apply.
 *
 * @param existing - The connection reused.
 * @param candidate - The connection the settings would have written.
 * @param given - The settings the developer gave.
 * @returns The settings not applied.
 */
export function unappliedSettings(
  existing: Connection,
  candidate: Connection,
  given: readonly ConnectionSetting[],
): readonly ConnectionSetting[] {
  return given.filter((setting) => {
    if (setting === "display name") {
      return existing.displayName !== candidate.displayName;
    }
    return (existing.scopes ?? []).join(" ") !== (candidate.scopes ?? []).join(" ");
  });
}

/**
 * The connection of the developer's own a candidate would be: the one with its
 * slug, when that one connects to the same issuer.
 *
 * @param connections - The project's connections.
 * @param candidate - The new connection.
 * @param options - What is known beyond the file.
 * @returns The existing connection, or `undefined`.
 */
function existingCustomConnection(
  connections: readonly Connection[],
  candidate: Connection,
  options: LookupOptions,
): Connection | undefined {
  const match = connectionNamed(connections, candidate.name, candidate.issuer);
  if (match === undefined) {
    refuseTakenFileName(connections, candidate);
    refuseCollidingVariables(connections, candidate.credentialNames, candidate.name);
    return undefined;
  }
  refuseDifferentClientId(match, options.clientId);
  refuseCollidingVariables(connections, match.credentialNames, candidate.name, match);
  return match;
}

/**
 * Refuse a new connection whose file name another connection already has:
 * writing it would replace that one.
 *
 * @param connections - The project's connections.
 * @param candidate - The new connection.
 * @throws {@link ConflictError} When the name is taken.
 */
function refuseTakenFileName(connections: readonly Connection[], candidate: Connection): void {
  const occupied = connections.find((connection) => {
    return basename(connection.path) === basename(candidate.path);
  });
  if (occupied === undefined) {
    return;
  }
  const theirs = (occupied.slug ?? "").trim();
  if (theirs === candidate.name) {
    throw new ConflictError(
      `${candidate.path} is a connection called ${candidate.name}, but not to ${candidate.displayName ?? candidate.name}: its issuer is not ${candidate.issuer ?? "the same"}`,
      {
        hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
        details: { file: candidate.path, slug: theirs },
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
 * Refuse an issuer other than the one an existing connection was written with.
 * An applied connection keeps its issuer, and the server compares it exactly.
 *
 * @param connection - The existing connection.
 * @param slug - Its slug.
 * @param issuer - The issuer the developer gave.
 * @throws {@link ConflictError} When they differ.
 */
function refuseChangedIssuer(connection: Connection, slug: string, issuer: string): void {
  if (connection.issuer === issuer) {
    return;
  }
  const hint =
    "An applied connection keeps its issuer, and the server compares it exactly, so even a trailing slash names another provider. " +
    "Choose another slug for this connection, then move the schemas and flows that name the old one to it.";
  const details = {
    file: connection.path,
    slug,
    issuer,
    existing_issuer: connection.issuer ?? null,
  };
  if (connection.issuer === undefined) {
    throw new ConflictError(
      `${connection.path} is already named ${slug} and is not an OIDC connection to ${issuer}`,
      {
        hint,
        details,
      },
    );
  }
  throw new ConflictError(
    `${connection.path} is already named ${slug} and connects to ${connection.issuer}, not ${issuer}`,
    {
      hint,
      details,
    },
  );
}

/**
 * Refuse a client id other than the one an existing connection holds as a
 * value. A connection that references a variable holds no id to disagree with.
 *
 * @param connection - The existing connection.
 * @param clientId - The client id the developer gave.
 * @throws {@link ConfigError} When they differ.
 */
function refuseDifferentClientId(connection: Connection, clientId: string | undefined): void {
  const existing = connection.clientId;
  if (
    clientId === undefined ||
    existing === undefined ||
    isVariableReference(existing) ||
    existing === clientId
  ) {
    return;
  }
  throw new ConfigError(`${connection.path} already uses client id ${existing}, not ${clientId}`, {
    hint: "Edit the connection file to change its client id, or run the command without one to reuse it.",
    details: { file: connection.path, stored_client_id: existing, supplied_client_id: clientId },
  });
}

/**
 * Refuse credentials that would land in another connection's variable, or
 * both in one. A publish would overwrite what the other credential put there,
 * and the loser signs in with the wrong application, which surfaces at the
 * provider and not here.
 *
 * @param connections - The project's connections.
 * @param ours - The variables this connection reads.
 * @param slug - Its slug.
 * @param except - The connection being reused, which is not its own collision.
 * @throws {@link ConflictError} When a variable is shared.
 */
function refuseCollidingVariables(
  connections: readonly Connection[],
  ours: CredentialNames,
  slug: string,
  except?: Connection,
): void {
  if (ours.clientId !== undefined && ours.clientId === String(ours.clientSecret)) {
    throw new ConflictError(`This connection points both credentials at ${ours.clientId}`, {
      hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
      details: { slug, variable: ours.clientId },
    });
  }
  const names: readonly string[] = [ours.clientId, ours.clientSecret].filter((name) => {
    return name !== undefined;
  });
  for (const connection of connections) {
    if (connection === except) {
      continue;
    }
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

/** A connection's path. */
function pathOf(connection: Connection): string {
  return connection.path;
}

/** The connections' paths, for a message. */
function paths(connections: readonly Connection[]): string {
  return connections.map(pathOf).join(", ");
}
