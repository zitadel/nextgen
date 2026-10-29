import { isObject } from "../json";

/** One row of a connection's claim mapping: a user attribute and the claim that fills it. */
export type MappingRow = {
  readonly attribute: string;
  readonly claim: string;
};

/** One row of a connection's verification: an attribute and what makes it trusted. */
export type VerificationRow = {
  readonly attribute: string;
  /** The claim that must be true, or `true` when the provider is trusted outright. */
  readonly claim: string | true;
};

/** What a connection document says about filling a user from a sign-in. */
export type ConnectionMappings = {
  readonly mapping: readonly MappingRow[];
  readonly verification: readonly VerificationRow[];
  readonly scopes: readonly string[];
};

/**
 * Read the claim mapping, the verification and the scopes out of a connection
 * document. Anything that is not the expected shape reads as absent: the
 * summary describes the file, and judging it is `deploy`'s job.
 */
export function readMappings(connection: object): ConnectionMappings {
  const body = connection as Record<string, unknown>;
  const rows = (value: unknown): [string, unknown][] =>
    isObject(value) ? Object.entries(value) : [];
  const oidc = isObject(body.oidc) ? body.oidc : {};
  return {
    mapping: rows(body.claim_mapping).flatMap(([attribute, claim]) =>
      typeof claim === "string" ? [{ attribute, claim }] : [],
    ),
    verification: rows(body.verified_claims).flatMap<VerificationRow>(([attribute, claim]) =>
      typeof claim === "string"
        ? [{ attribute, claim }]
        : claim === true
          ? [{ attribute, claim: true }]
          : [],
    ),
    scopes: Array.isArray(oidc.scopes)
      ? oidc.scopes.filter((scope): scope is string => typeof scope === "string")
      : [],
  };
}

/** A list as an English phrase: "a", "a and b", "a, b and c". */
function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The mapping as sentences for a person: one line per attribute saying which
 * claim fills it and, folded into the same sentence, what makes it trusted —
 * because to a reader "email comes from the email claim, verified when
 * email_verified is true" is one fact about email, not two tables to cross-
 * reference. A verification for an attribute that no claim fills has nothing to
 * fold into and is left out; `deploy` is where such a mismatch is judged.
 *
 * @param file - The connection file, named so the person knows where to edit.
 */
export function mappingLines(connection: object, file: string): string[] {
  const { mapping, verification, scopes } = readMappings(connection);
  const verifiedBy = new Map(verification.map((row) => [row.attribute, row.claim]));
  const lines: string[] = [];
  if (mapping.length === 0) {
    lines.push(
      `No attribute is filled from a claim yet. Add attribute: claim pairs to claim_mapping in ${file}.`,
    );
  } else {
    lines.push("Each user attribute is filled from a claim your provider returns:");
    for (const row of mapping) {
      const how = verifiedBy.get(row.attribute);
      const trusted =
        how === undefined
          ? ""
          : how === true
            ? ", and is always trusted"
            : `, verified when ${how} is true`;
      lines.push(`  • ${row.attribute} comes from the ${row.claim} claim${trusted}.`);
    }
  }
  if (scopes.length > 0) {
    lines.push(
      "",
      `It asks your provider for the ${sentenceList(scopes)} scope${scopes.length > 1 ? "s" : ""}.`,
    );
  }
  return lines;
}

/**
 * The attributes a connection has no claim for, out of the ones the schemas
 * that sign in through it define. A claim the file holds as something other
 * than a string reads as absent, so it counts as unmapped here too. Sorted and
 * de-duplicated; a connection no schema uses is passed no attributes and so
 * reports none.
 */
export function unmappedAttributes(connection: object, attributes: Iterable<string>): string[] {
  const mapped = new Set(readMappings(connection).mapping.map((row) => row.attribute));
  return [...new Set(attributes)].filter((attribute) => !mapped.has(attribute)).sort();
}

/** An attribute no claim fills, and whether a sign-in needs it. */
export type UnmappedAttribute = {
  readonly name: string;
  readonly required: boolean;
};

/**
 * The block naming the attributes still without a claim, told as information
 * rather than an instruction: an attribute that no claim fills is only a
 * problem when a sign-in needs it. A required one is flagged to map before a
 * deploy; an optional one (an `employee_id` the provider may simply never
 * send) is called fine to leave. Empty when every attribute the signing-in
 * schemas define is already mapped.
 */
export function unmappedLines(unmapped: readonly UnmappedAttribute[]): string[] {
  if (unmapped.length === 0) {
    return [];
  }
  return [
    "",
    "Some attributes have no claim yet:",
    ...unmapped.map((attribute) =>
      attribute.required
        ? `  • ${attribute.name} (required) — a sign-in fills this, so map it before you deploy.`
        : `  • ${attribute.name} (optional) — fine to leave empty.`,
    ),
  ];
}

/**
 * The block naming the schemas that sign in through this connection, so a
 * change to its mapping shows who it affects. A connection no schema references
 * yet is called out the other way: nothing signs in through it, so changing it
 * changes nothing today.
 */
export function usedByLines(schemas: readonly string[]): string[] {
  if (schemas.length === 0) {
    return [
      "",
      "No user schema signs in through this connection yet, so changing it affects nothing today.",
    ];
  }
  const verb = schemas.length > 1 ? "sign" : "signs";
  const them = schemas.length > 1 ? "them" : "it";
  return [
    "",
    `${sentenceList(schemas)} ${verb} in through this connection, so changes here affect ${them}.`,
  ];
}

/**
 * Where a connection stands, so "saved", "applied" and "tested" are not
 * confused. `present` is a connection file that was already there: whether it
 * reached the server is not known here.
 */
export type ConnectionStatus = "saved" | "applied" | "present";

/**
 * What is still to do for a connection, in the order it is done. The first
 * step depends on whether the connection already reached the server; the last
 * is always true, because a sign-in is the only proof that the claims a
 * provider returns are the ones the mapping names.
 */
export function stillToConfigure(options: {
  readonly status: ConnectionStatus;
  readonly file: string;
  readonly provider: string;
}): string[] {
  const { status, file, provider } = options;
  return [
    `Register the redirect URI at ${provider}.`,
    `Check the claim names in ${file}.`,
    ...(status === "saved" ? ["Run `zitadel deploy`."] : []),
    "Sign in once: until then the mapping is untested.",
  ];
}

/** The state line: where the connection exists, and that no sign-in has tested it. */
export function statusLine(status: ConnectionStatus): string {
  switch (status) {
    case "saved":
      return "Saved in your project. Not applied, not tested.";
    case "applied":
      return "Saved and applied. Not tested with a sign-in.";
    case "present":
      return "In your project. `zitadel deploy --dry-run` shows whether it is deployed. Not tested.";
  }
}
