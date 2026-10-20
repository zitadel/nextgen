import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError } from "../errors";
import { isObject } from "../json";
import { shellWord } from "./custom";

/** The value types a claim can carry into a user-schema property. */
export const CLAIM_TYPES = ["string", "number", "integer", "boolean"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** A user-schema property, as far as filling it from a claim is concerned. */
export type SchemaAttribute = {
  readonly name: string;
  /** `undefined` for an object, an array or an untyped property: a claim cannot fill it. */
  readonly type: ClaimType | undefined;
  readonly required: boolean;
  readonly unique: boolean;
};

/** One mapping: the schema property, the provider claim, and the claim's declared type. */
export type ClaimEntry = {
  readonly attribute: string;
  readonly claim: string;
  /** What the provider returns. Left out, it is the standard's type, else a string. */
  readonly type?: ClaimType;
  /**
   * The property does not exist yet: add it to the user schema, typed to hold
   * the claim, and map the claim to it.
   */
  readonly create?: boolean;
};

/** How a property is verified: the boolean claim that says so, or `true` to trust the provider. */
export type VerifiedEntry = {
  readonly attribute: string;
  readonly source: string | true;
};

/** Everything the developer asked for beyond the defaults. */
export type ClaimRequest = {
  readonly entries: readonly ClaimEntry[];
  readonly verified: readonly VerifiedEntry[];
  /** Extra scopes the provider needs before it returns the claims. */
  readonly scopes: readonly string[];
};

export const NO_CLAIM_REQUEST: ClaimRequest = { entries: [], verified: [], scopes: [] };

/** Where a mapping stands while it is built up and checked. */
export type MappingState = {
  readonly attributes: readonly SchemaAttribute[];
  /** Schema property → claim. */
  readonly mapping: Readonly<Record<string, string>>;
  /** Claim → the type it was declared with, for checking against the property. */
  readonly claimTypes: Readonly<Record<string, ClaimType>>;
  /** Schema property → the claim that verifies it, or `true`. */
  readonly verified: Readonly<Record<string, string | true>>;
  readonly scopes: readonly string[];
  /**
   * Properties a request has mapped. A property the defaults mapped is not here
   * and a request may replace it; one in here is settled for this request.
   */
  readonly explicit: readonly string[];
  /** Properties whose default was replaced and which had been verified by the claim replaced. */
  readonly unverifiedByReplacing: readonly string[];
  /** Properties the request adds to the user schema, so the commands can write them. */
  readonly created: readonly SchemaAttribute[];
};

type StandardClaim = {
  readonly claim: string;
  readonly type: ClaimType;
  /** The scope that makes a provider return it (OpenID Connect Core 5.4). */
  readonly scope: string;
  /** The boolean claim that says the provider checked it. */
  readonly verifiedBy?: string;
};

/**
 * The claims OpenID Connect itself defines, with the type and the scope each
 * comes with. Not a list of providers: every conforming provider returns these
 * for these scopes, so it is the default mapping for any of them.
 */
const STANDARD_CLAIMS: readonly StandardClaim[] = [
  { claim: "name", type: "string", scope: "profile" },
  { claim: "given_name", type: "string", scope: "profile" },
  { claim: "family_name", type: "string", scope: "profile" },
  { claim: "middle_name", type: "string", scope: "profile" },
  { claim: "nickname", type: "string", scope: "profile" },
  { claim: "preferred_username", type: "string", scope: "profile" },
  { claim: "profile", type: "string", scope: "profile" },
  { claim: "picture", type: "string", scope: "profile" },
  { claim: "website", type: "string", scope: "profile" },
  { claim: "gender", type: "string", scope: "profile" },
  { claim: "birthdate", type: "string", scope: "profile" },
  { claim: "zoneinfo", type: "string", scope: "profile" },
  { claim: "locale", type: "string", scope: "profile" },
  { claim: "updated_at", type: "number", scope: "profile" },
  { claim: "email", type: "string", scope: "email", verifiedBy: "email_verified" },
  { claim: "email_verified", type: "boolean", scope: "email" },
  { claim: "phone_number", type: "string", scope: "phone", verifiedBy: "phone_number_verified" },
  { claim: "phone_number_verified", type: "boolean", scope: "phone" },
];

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const refuse = (problem: string): Parsed<never> => ({ ok: false, problem });

/** The standard's type for a claim, or `undefined` for one it does not define. */
export function standardClaimType(claim: string): ClaimType | undefined {
  return STANDARD_CLAIMS.find((standard) => standard.claim === claim)?.type;
}

/** The scope that makes a provider return a standard claim, or `undefined` for one the standard does not define. */
export function standardClaimScope(claim: string): string | undefined {
  return STANDARD_CLAIMS.find((standard) => standard.claim === claim)?.scope;
}

/** A claim name no property is filled from yet, or what already uses it. */
export function parseUnusedClaim(state: MappingState, value: string): Parsed<string> {
  const claim = parseClaimName(value);
  if (!claim.ok) {
    return claim;
  }
  const holder = Object.entries(state.mapping).find(([, used]) => used === claim.value)?.[0];
  return holder === undefined
    ? claim
    : refuse(`${claim.value} already fills ${holder}: a claim fills one property.`);
}

/** `given_name` as `givenName`: the property a standard claim fills when the names match. */
function propertyNameOf(claim: string): string {
  return claim.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Whether a value of the claim's type can be stored in a property of the other. */
export function fits(claim: ClaimType, attribute: ClaimType): boolean {
  return claim === attribute || (claim === "integer" && attribute === "number");
}

function scalarType(type: unknown): ClaimType | undefined {
  if (typeof type === "string") {
    return (CLAIM_TYPES as readonly string[]).includes(type) ? (type as ClaimType) : undefined;
  }
  if (Array.isArray(type)) {
    const real = type.filter((one) => one !== "null");
    return real.length === 1 ? scalarType(real[0]) : undefined;
  }
  return undefined;
}

/** The properties a user schema document defines. */
export function attributesOf(body: Record<string, unknown>): SchemaAttribute[] {
  const properties = isObject(body.properties) ? body.properties : {};
  const required = Array.isArray(body.required) ? body.required : [];
  return Object.entries(properties).map(([name, definition]) => ({
    name,
    type: isObject(definition) ? scalarType(definition.type) : undefined,
    required: required.includes(name),
    unique: isObject(definition) && typeof definition["x-unique"] === "string",
  }));
}

/** A claim name as typed: one word, read from the top level of the claims. */
export function parseClaimName(value: string): Parsed<string> {
  const claim = value.trim();
  if (claim === "") {
    return refuse("Enter the claim's name.");
  }
  if (/\s/.test(claim)) {
    return refuse("A claim name has no spaces.");
  }
  if (claim.startsWith("$")) {
    return refuse(
      "A claim name cannot start with $, which the connection reserves for future forms.",
    );
  }
  return ok(claim);
}

/** Scopes as typed, separated by spaces or commas. Nothing typed is none. */
export function parseScopeList(value: string): Parsed<string[]> {
  return ok([...new Set(value.split(/[\s,]+/).filter((scope) => scope !== ""))]);
}

const TYPE_ALIASES: Readonly<Record<string, ClaimType>> = {
  int: "integer",
  long: "integer",
  bool: "boolean",
  str: "string",
  text: "string",
  float: "number",
  double: "number",
  num: "number",
};

/**
 * What is wrong with a colon-word that nearly spells a type. A namespaced
 * claim (`urn:acme:roles`) also ends in a colon-word, so only a near miss of
 * a type is refused: the wrong case, or a common alias.
 */
function suffixMisspelling(rest: string): string | undefined {
  if (rest.startsWith(":") || rest.endsWith(":")) {
    return "A claim name does not start or end with a colon.";
  }
  const typed = /:([A-Za-z]+)$/.exec(rest)?.[1];
  const word = typed?.toLowerCase();
  const meant =
    word === undefined
      ? undefined
      : (CLAIM_TYPES as readonly string[]).includes(word)
        ? word
        : TYPE_ALIASES[word];
  return meant === undefined
    ? undefined
    : `:${typed} is not a type here. Did you mean :${meant}? The types are ${CLAIM_TYPES.join(", ")}, in lower case.`;
}

/** `staffNumber=employee_id:integer`: the property, the claim and, after a colon, the claim's type. */
export function parseClaimEntry(text: string): Parsed<ClaimEntry> {
  const at = text.indexOf("=");
  const attribute = at < 1 ? "" : text.slice(0, at).trim();
  const rest = at < 1 ? "" : text.slice(at + 1).trim();
  if (attribute === "" || rest === "") {
    return refuse(
      `"${text}" is not <property>=<claim>, e.g. staffNumber=employee_id:integer or contactEmail=mail.`,
    );
  }
  const typed = /^(.+):(string|number|integer|boolean)$/.exec(rest);
  const misspelt = typed === null ? suffixMisspelling(rest) : undefined;
  if (misspelt !== undefined) {
    return refuse(`${text}: ${misspelt}`);
  }
  const claim = parseClaimName(typed?.[1] ?? rest);
  if (!claim.ok) {
    return refuse(`${text}: ${claim.problem}`);
  }
  return ok({
    attribute,
    claim: claim.value,
    ...(typed === null ? {} : { type: typed[2] as ClaimType }),
  });
}

/** `contactEmail=email_verified`, or `contactEmail=true` to trust the provider for it. */
export function parseVerifiedEntry(text: string): Parsed<VerifiedEntry> {
  const at = text.indexOf("=");
  const attribute = at < 1 ? "" : text.slice(0, at).trim();
  const rest = at < 1 ? "" : text.slice(at + 1).trim();
  if (attribute === "" || rest === "") {
    return refuse(
      `"${text}" is not <property>=<claim> or <property>=true, e.g. contactEmail=email_verified.`,
    );
  }
  if (rest === "true") {
    return ok({ attribute, source: true });
  }
  if (rest.toLowerCase() === "true" || rest.toLowerCase() === "false") {
    return refuse(
      `${text}: ${rest.toLowerCase() === "true" ? "to trust the provider write exactly true" : "leave a property out of verification to leave it unverified"}.`,
    );
  }
  const claim = parseClaimName(rest);
  return claim.ok ? ok({ attribute, source: claim.value }) : refuse(`${text}: ${claim.problem}`);
}

const union = (...lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat())];

/**
 * Start from what a connection document already maps, and add the standard
 * claims whose scope it requests and whose name matches a property of the
 * schema, so a schema with `givenName` or `picture` is filled without being asked.
 *
 * A standard claim is only added when the connection already asks for its
 * scope: adding a scope the provider does not know would break its sign-in.
 */
export function seedMapping(
  document: Record<string, unknown>,
  attributes: readonly SchemaAttribute[],
): MappingState {
  const stringsOf = (value: unknown): Record<string, string> =>
    isObject(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  const oidc = isObject(document.oidc) ? document.oidc : {};
  const scopes = Array.isArray(oidc.scopes)
    ? oidc.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  const existing = stringsOf(document.claim_mapping);
  const verifiedGiven = isObject(document.verified_claims) ? document.verified_claims : {};
  const verified: Record<string, string | true> = {};
  for (const [attribute, source] of Object.entries(verifiedGiven)) {
    if (typeof source === "string" || source === true) {
      verified[attribute] = source;
    }
  }

  const mapping: Record<string, string> = { ...existing };
  const used = new Set(Object.values(mapping));
  for (const standard of STANDARD_CLAIMS) {
    const attribute = attributes.find((one) => one.name === propertyNameOf(standard.claim));
    if (
      attribute !== undefined &&
      attribute.type !== undefined &&
      fits(standard.type, attribute.type) &&
      scopes.includes(standard.scope) &&
      !(attribute.name in mapping) &&
      !used.has(standard.claim)
    ) {
      mapping[attribute.name] = standard.claim;
      used.add(standard.claim);
    }
  }
  for (const [attribute, claim] of Object.entries(mapping)) {
    const verifiedBy = STANDARD_CLAIMS.find((standard) => standard.claim === claim)?.verifiedBy;
    if (verifiedBy !== undefined && !(attribute in verified)) {
      verified[attribute] = verifiedBy;
    }
  }
  return {
    attributes,
    mapping,
    claimTypes: Object.fromEntries(
      Object.values(mapping).map((claim) => [claim, standardClaimType(claim) ?? "string"]),
    ),
    verified,
    scopes,
    explicit: [],
    unverifiedByReplacing: [],
    created: [],
  };
}

/**
 * The properties a claim of this type could fill: the empty ones and the ones
 * only the defaults filled, which a request may replace.
 */
export function fillable(state: MappingState, claimType: ClaimType): SchemaAttribute[] {
  return state.attributes.filter(
    (attribute) =>
      attribute.type !== undefined &&
      fits(claimType, attribute.type) &&
      !state.explicit.includes(attribute.name),
  );
}

/** Whether any property could still take a claim, empty or filled by default. */
export function hasFillable(state: MappingState): boolean {
  return state.attributes.some(
    (attribute) => attribute.type !== undefined && !state.explicit.includes(attribute.name),
  );
}

/** The properties no claim fills yet that a claim of this type could fill. */
export function unmapped(state: MappingState, claimType: ClaimType): SchemaAttribute[] {
  return state.attributes.filter(
    (attribute) =>
      attribute.type !== undefined &&
      fits(claimType, attribute.type) &&
      !(attribute.name in state.mapping),
  );
}

/**
 * A name for a property the request adds to the user schema. The schema only
 * forbids a dot, but the name is a JSON key and a field in the login flow, so
 * it is held to a plain identifier. It must not already be a property.
 */
export function parseNewAttributeName(value: string, taken: readonly string[]): Parsed<string> {
  const name = value.trim();
  if (name === "") {
    return refuse("Enter a name for the attribute.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return refuse(
      "Use letters, digits and underscores, starting with a letter, as in employeeNumber.",
    );
  }
  return taken.includes(name) ? refuse(`"${name}" is already a user attribute.`) : ok(name);
}

const describe = (attribute: SchemaAttribute): string =>
  `${attribute.name} (${attribute.type ?? "not a string, number, integer or boolean"})`;

/**
 * Map one claim to one property, or say why that is refused: the property is
 * not in the schema or is not a scalar, it is already filled, the claim
 * already fills another, or the claim's type does not fit the property's.
 */
export function mapClaim(state: MappingState, entry: ClaimEntry): Parsed<MappingState> {
  if (entry.create === true) {
    const name = parseNewAttributeName(
      entry.attribute,
      state.attributes.map((one) => one.name),
    );
    if (!name.ok) {
      return name;
    }
    const type = entry.type ?? standardClaimType(entry.claim) ?? "string";
    const added: SchemaAttribute = { name: name.value, type, required: false, unique: false };
    return mapClaim(
      { ...state, attributes: [...state.attributes, added], created: [...state.created, added] },
      { attribute: entry.attribute, claim: entry.claim, type: entry.type },
    );
  }
  const attribute = state.attributes.find((one) => one.name === entry.attribute);
  if (attribute === undefined) {
    return refuse(
      `${entry.attribute} is not a property of the user schema, which defines ${
        state.attributes.map((one) => one.name).join(", ") || "none"
      }.`,
    );
  }
  if (attribute.type === undefined) {
    return refuse(
      `${attribute.name} cannot be filled from a claim: only a string, number, integer or boolean property can.`,
    );
  }
  const filledBy = state.mapping[attribute.name];
  if (filledBy !== undefined && state.explicit.includes(attribute.name)) {
    return refuse(
      `${attribute.name} is already filled from ${filledBy}: a property takes one claim.`,
    );
  }
  const claimFills = Object.entries(state.mapping).find(
    ([property, claim]) => claim === entry.claim && property !== attribute.name,
  )?.[0];
  if (claimFills !== undefined) {
    return refuse(
      `${entry.claim} already fills ${claimFills}: a claim fills one property. To move it, map ${claimFills} to another claim first.`,
    );
  }
  const standard = standardClaimType(entry.claim);
  if (standard !== undefined && entry.type !== undefined && entry.type !== standard) {
    return refuse(`${entry.claim} is a ${standard} claim in OpenID Connect, not ${entry.type}.`);
  }
  const claimType = entry.type ?? standard ?? "string";
  if (!fits(claimType, attribute.type)) {
    const hint =
      standard === undefined
        ? ` If the provider returns it as ${attribute.type}, say so: ${attribute.name}=${entry.claim}:${attribute.type}.`
        : "";
    return refuse(
      `${entry.claim} is a ${claimType} claim and ${describe(attribute)} would not hold it.${hint}`,
    );
  }
  const mapping = { ...state.mapping, [attribute.name]: entry.claim };
  // Replacing a default drops what verified the claim it replaced: that claim
  // said nothing about this one.
  const replaced = filledBy !== undefined && filledBy !== entry.claim;
  const wasVerified = attribute.name in state.verified;
  const { [attribute.name]: _dropped, ...stillVerified } = state.verified;
  void _dropped;
  return ok({
    ...state,
    mapping,
    claimTypes: {
      ...Object.fromEntries(
        Object.entries(state.claimTypes).filter(([claim]) =>
          Object.values(mapping).includes(claim),
        ),
      ),
      [entry.claim]: claimType,
    },
    verified: replaced ? stillVerified : state.verified,
    explicit: [...state.explicit, attribute.name],
    unverifiedByReplacing:
      replaced && wasVerified
        ? [...state.unverifiedByReplacing, attribute.name]
        : state.unverifiedByReplacing,
  });
}

/**
 * What a person should hear about the state: a property whose default was
 * replaced and has not been given a verification since. Worked out from the
 * state, so verifying the property afterwards takes the note away.
 */
export function claimNotes(state: MappingState): string[] {
  return state.unverifiedByReplacing
    .filter((attribute) => !(attribute in state.verified))
    .map(
      (attribute) =>
        `${attribute} is now filled from ${state.mapping[attribute]} and is no longer verified, so a user whose ${attribute} must be unique is asked to confirm it at sign-up. Say how the provider verifies it with --verified-claim ${attribute}=<claim> (or =true to trust the provider).`,
    );
}

/**
 * Say how a mapped property is verified. A property with no mapping has
 * nothing to verify, and `plan` refuses a `verified_claims` key without one.
 */
export function verifyAttribute(state: MappingState, entry: VerifiedEntry): Parsed<MappingState> {
  if (!(entry.attribute in state.mapping)) {
    return refuse(
      `${entry.attribute} has no claim mapping, so there is nothing to verify. Map it first.`,
    );
  }
  return ok({ ...state, verified: { ...state.verified, [entry.attribute]: entry.source } });
}

/** Apply a request in order: the mappings, then their scopes, then how they are verified. */
export function applyRequest(state: MappingState, request: ClaimRequest): Parsed<MappingState> {
  let current = state;
  for (const entry of request.entries) {
    const mapped = mapClaim(current, entry);
    if (!mapped.ok) {
      return mapped;
    }
    current = mapped.value;
  }
  current = { ...current, scopes: union(current.scopes, request.scopes) };
  for (const entry of request.verified) {
    const verified = verifyAttribute(current, entry);
    if (!verified.ok) {
      return verified;
    }
    current = verified.value;
  }
  return ok(current);
}

/**
 * The connection document with the mapping, its verification and its scopes
 * written in. A block the state leaves empty is removed, not left as the
 * provider scaffolded it: the state is what the connection ends up with.
 */
export function withClaims(
  document: Record<string, unknown>,
  state: MappingState,
): Record<string, unknown> {
  const { claim_mapping: _mapping, verified_claims: _verified, ...rest } = document;
  void _mapping;
  void _verified;
  const oidc = isObject(document.oidc) ? document.oidc : {};
  return {
    ...rest,
    ...(Object.keys(state.mapping).length > 0 ? { claim_mapping: { ...state.mapping } } : {}),
    ...(Object.keys(state.verified).length > 0 ? { verified_claims: { ...state.verified } } : {}),
    oidc: { ...oidc, scopes: [...state.scopes] },
  };
}

/**
 * One line per mapping, for a summary: `staffNumber ← employee_id`, with how
 * the provider verifies it when it does.
 */
export function describeMapping(state: MappingState): string[] {
  const lines = Object.entries(state.mapping).map(([attribute, claim]) => {
    const source = state.verified[attribute];
    const how =
      source === undefined
        ? ""
        : source === true
          ? " (the provider is trusted)"
          : ` (verified by ${source})`;
    return `${attribute} ← ${claim}${how}`;
  });
  return lines;
}

/** {@link describeMapping} and the scopes the connection asks for, as a summary prints them. */
export function summariseClaims(state: MappingState): string[] {
  return [...describeMapping(state), `scopes: ${state.scopes.join(" ")}`];
}

/**
 * The document for a connection, with a request applied over the defaults.
 * The one place the defaults and a request meet, shared by the commands.
 */
export function claimedConnection(
  document: Record<string, unknown>,
  attributes: readonly SchemaAttribute[],
  request: ClaimRequest,
): Parsed<{
  readonly document: Record<string, unknown>;
  readonly notes: readonly string[];
  readonly summary: readonly string[];
  readonly created: readonly SchemaAttribute[];
}> {
  const applied = applyRequest(seedMapping(document, attributes), request);
  return applied.ok
    ? ok({
        document: withClaims(document, applied.value),
        notes: claimNotes(applied.value),
        summary: summariseClaims(applied.value),
        created: applied.value.created,
      })
    : applied;
}

/** How a command spells the flags that carry a claim request, so a message names the one to fix. */
export type ClaimFlagNames = {
  readonly claim: string;
  readonly scope: string;
  readonly verified: string;
};

/** The flags on `auth-method sso enable`. */
export const ENABLE_CLAIM_FLAGS: ClaimFlagNames = {
  claim: "--claim",
  scope: "--claim-scope",
  verified: "--verified-claim",
};

/** The flags on `setup`, which carries them for the provider it enables. */
export const SETUP_CLAIM_FLAGS: ClaimFlagNames = {
  claim: "--sso-claim",
  scope: "--sso-claim-scope",
  verified: "--sso-verified-claim",
};

/** The flag values a command parsed, before they are read as a request. */
export type ClaimFlagValues = {
  readonly claim?: readonly string[];
  readonly scope?: string;
  readonly verified?: readonly string[];
};

/** The value of a parse, or an `E_VALIDATION` that says what to fix. */
export function claimsOrRefuse<T>(parsed: Parsed<T>, where: string): T {
  if (!parsed.ok) {
    throw new ZitadelError("E_VALIDATION", `${where}${parsed.problem}`, {
      hint: "Fix the claim mapping and run the command again.",
    });
  }
  return parsed.value;
}

/**
 * Read the flags as a request. Each entry is checked for its shape as it is
 * read, naming the flag that carried it; whether it fits the schema is for
 * {@link applyRequest}, which needs the schema.
 */
export function claimRequestFromFlags(
  values: ClaimFlagValues,
  names: ClaimFlagNames,
): ClaimRequest {
  return {
    entries: (values.claim ?? []).map((text) =>
      claimsOrRefuse(parseClaimEntry(text), `${names.claim}: `),
    ),
    verified: (values.verified ?? []).map((text) =>
      claimsOrRefuse(parseVerifiedEntry(text), `${names.verified}: `),
    ),
    scopes: claimsOrRefuse(parseScopeList(values.scope ?? ""), `${names.scope}: `),
  };
}

/** Whether a request asks for anything. */
export function asksForClaims(request: ClaimRequest): boolean {
  return request.entries.length + request.verified.length + request.scopes.length > 0;
}

/** The flags that restate a request, for a command offered as text. */
export function claimFlagText(request: ClaimRequest, names: ClaimFlagNames): string {
  return [
    ...request.entries.map(
      (entry) =>
        `${names.claim} ${shellWord(`${entry.attribute}=${entry.claim}${entry.type === undefined ? "" : `:${entry.type}`}`)}`,
    ),
    ...request.verified.map(
      (entry) => `${names.verified} ${shellWord(`${entry.attribute}=${entry.source}`)}`,
    ),
    ...(request.scopes.length === 0
      ? []
      : [`${names.scope} ${shellWord(request.scopes.join(" "))}`]),
  ].join(" ");
}
