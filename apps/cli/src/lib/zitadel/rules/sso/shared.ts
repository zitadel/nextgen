import { basename } from "node:path";

import type { ZitadelConfig } from "@/lib/zitadel/config";
import { claimName, type PropertyName } from "@/lib/zitadel/names";
import type { Connection } from "@/lib/zitadel/resources/connections/connection";
import type { ClaimRead } from "@/lib/zitadel/resources/connections/types";
import type { UserSchema } from "@/lib/zitadel/resources/schemas/schema";

/**
 * A name in quotes, as every message prints one.
 *
 * @param value - The name.
 * @returns The name in double quotes.
 */
export function quote(value: string): string {
  return JSON.stringify(value);
}

/**
 * "a" or "an" before a type name.
 *
 * @param word - The type name.
 * @returns The article.
 */
export function article(word: string): string {
  if (/^[aeiou]/.test(word)) {
    return "an";
  }
  return "a";
}

/**
 * A connection that stands for its slug, with what the rules ask about it.
 */
export type Standing = {
  /**
   * The connection, the first file in path order with its slug.
   */
  readonly connection: Connection;

  /**
   * The slug it stands for, as the file writes it.
   */
  readonly slug: string;

  /**
   * The schemas that list the slug, which are the ones that consume its
   * mapping.
   */
  readonly listing: readonly UserSchema[];
};

/**
 * The connections that stand for their slug: the first file in path order
 * with each slug. A second file claiming one is reported once, as a duplicate.
 *
 * @param config - The configuration.
 * @returns Each such connection, with the schemas that list it.
 */
export function standing(config: ZitadelConfig): readonly Standing[] {
  return config.connections.all.flatMap((connection) => {
    const slug = connection.slug;
    if (config.connections.find(slug) !== connection) {
      return [];
    }
    return [{ connection, slug, listing: config.schemas.listOffering(slug) }];
  });
}

/**
 * The claims a connection reads by name: its mappings, then its
 * verifications that name a claim rather than always verify.
 *
 * @param connection - The connection.
 * @returns Each claim and the block it is read in.
 */
export function claimReads(connection: Connection): readonly ClaimRead[] {
  const mapped = connection.mappings.map((row): ClaimRead => {
    return { field: "claim_mapping", claim: claimName(row.claim) };
  });
  const verified = connection.verifications.flatMap((row): readonly ClaimRead[] => {
    if (typeof row.claim !== "string") {
      return [];
    }
    return [{ field: "verified_claims", claim: claimName(row.claim) }];
  });
  return [...mapped, ...verified];
}

/**
 * Whether no schema that lists a connection defines a property, so a mapping
 * into it is never read. Never true for a connection no schema lists, which
 * has nothing to be judged against.
 *
 * @param entry - The connection and the schemas that list it.
 * @param property - The property's name.
 * @returns Whether the property cannot be read.
 */
export function unreadable(entry: Standing, property: PropertyName): boolean {
  if (entry.listing.length === 0) {
    return false;
  }
  return !entry.listing.some((schema) => {
    return schema.has(property);
  });
}

/**
 * The properties of the schemas that list a connection.
 *
 * @param entry - The connection and the schemas that list it.
 * @returns Their property names.
 */
export function readableProperties(entry: Standing): readonly PropertyName[] {
  return entry.listing.flatMap((schema) => {
    return schema.propertyNames;
  });
}

/**
 * The slugs some connection stands for.
 *
 * @param config - The configuration.
 * @returns The slugs.
 */
export function knownSlugs(config: ZitadelConfig): readonly string[] {
  return standing(config).map((entry) => {
    return entry.slug;
  });
}

/**
 * Whether a connection file its contract refuses holds a slug.
 *
 * @remarks
 * Such a file is no connection, so nothing resolves to it, but it is there:
 * the contract finding already says what is wrong with it, and telling the
 * developer to add a file that exists would be wrong. A file with no slug in
 * its body, such as one that cannot be parsed, holds the slug its file name
 * gives.
 *
 * @param config - The configuration.
 * @param slug - The slug, as a schema or a flow writes it.
 * @returns Whether a broken connection file holds the slug, in its body or,
 *   when the body has none, in its file name.
 */
export function heldByBrokenConnection(config: ZitadelConfig, slug: string): boolean {
  return config.broken.some((file) => {
    if (file.kind !== "connection") {
      return false;
    }
    const written = file.body.slug;
    if (typeof written === "string") {
      return written === slug;
    }
    return basename(file.path, ".json") === slug;
  });
}
