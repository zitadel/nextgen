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
 * summary describes the file, and judging it is `plan`'s job.
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

/**
 * The mapping as lines for a person, the attribute on the left and the claim
 * it is read from on the right. The email mapping and what makes it verified
 * are two different facts, so they are two separate blocks.
 *
 * @param file - The connection file, named so the person knows where to edit.
 */
export function mappingLines(connection: object, file: string): string[] {
  const { mapping, verification, scopes } = readMappings(connection);
  const table = (rows: readonly { attribute: string; claim: string }[]): string[] => {
    const width = Math.max(...rows.map((row) => row.attribute.length));
    return rows.map((row) => `  ${row.attribute.padEnd(width)}  →  ${row.claim}`);
  };
  const lines: string[] = [];
  if (mapping.length === 0) {
    lines.push(`Claim mapping: none. Add attribute: claim pairs to claim_mapping in ${file}.`);
  } else {
    lines.push("Claim mapping (user attribute → claim):", ...table(mapping));
  }
  if (verification.length > 0) {
    lines.push(
      "",
      "Verified when (user attribute → claim that must be true):",
      ...table(
        verification.map((row) => ({
          attribute: row.attribute,
          claim: row.claim === true ? "(always trusted)" : row.claim,
        })),
      ),
    );
  }
  if (scopes.length > 0) {
    lines.push("", `Scopes: ${scopes.join(" ")}`);
  }
  return lines;
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
    ...(status === "saved" ? ["Run `zitadel plan`, then `zitadel apply`."] : []),
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
      return "In your project. `zitadel plan` shows whether it is applied. Not tested.";
  }
}
