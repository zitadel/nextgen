/**
 * The refusals `Connections` raises when a connection would step on
 * another one, and what it compares a found connection with.
 *
 * @remarks
 * Kept beside the collection, and used by it alone, so the collection reads as
 * its operations rather than as every way a lookup can refuse.
 */

import { basename } from "node:path";

import { credentialVariables, isVariableReference, parseConnectionSlug } from "@zitadel/config/idp";

import type { Connection, CredentialNames } from "@/lib/zitadel/resources/connections/connection";
import { ConfigError, ConflictError } from "@/lib/zitadel/errors";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

/**
 * A setting the developer gave for a connection, which an existing file may
 * not have.
 */
export type ConnectionSetting = "display name" | "scopes";

/**
 * What is known about a connection beyond its file.
 */
export type LookupOptions = Readonly<{
  /**
   * The client id the developer gave, which an existing file holding another
   * one contradicts.
   */
  clientId?: string | undefined;
}>;

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
 * Refuse a slug no connection has yet, when its file name is another
 * connection's or the variables it derives are: writing a connection under it
 * would replace that file or overwrite those credentials.
 *
 * @param connections - The project's connections.
 * @param slug - The slug.
 * @throws {@link ConflictError} When it is taken either way.
 */
export function refuseTakenSlug(connections: readonly Connection[], slug: string): void {
  const name = `${slug}.json`;
  if (
    connections.some((connection) => {
      return basename(connection.path) === name;
    })
  ) {
    const path = `${CONFIG_DIRECTORIES.connections}/${name}`;
    throw new ConflictError(`${path} already exists and is not the ${slug} connection`, {
      hint: "Rename or remove that file, or choose another slug, then run the command again.",
      details: { file: path, slug },
    });
  }
  const parsed = parseConnectionSlug(slug);
  if (parsed.ok) {
    refuseCollidingVariables(connections, credentialVariables(parsed.value), slug);
  }
}

/**
 * Refuse a new connection whose file name another connection already has:
 * writing it would replace that one.
 *
 * @param connections - The project's connections.
 * @param candidate - The new connection.
 * @throws {@link ConflictError} When the name is taken.
 */
export function refuseTakenFileName(connections: readonly Connection[], candidate: Connection): void {
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
export function refuseChangedIssuer(connection: Connection, slug: string, issuer: string): void {
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
export function refuseDifferentClientId(connection: Connection, clientId: string | undefined): void {
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
export function refuseCollidingVariables(
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

/**
 * A connection's path.
 *
 * @param connection - The connection.
 * @returns Its project-relative path.
 */
export function pathOf(connection: Connection): string {
  return connection.path;
}

/**
 * The connections' paths, for a message.
 *
 * @param connections - The connections.
 * @returns Their paths, joined by commas.
 */
export function paths(connections: readonly Connection[]): string {
  return connections.map(pathOf).join(", ");
}
