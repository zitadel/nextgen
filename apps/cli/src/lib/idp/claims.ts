import { type Parsed, validated } from "@zitadel/config/idp";

import { ZitadelError } from "@/lib/errors";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  type ClaimChoice,
  type Connection,
  standardClaim,
  STANDARD_CLAIMS,
  type UserSchema,
} from "@/lib/zitadel";

/**
 * The value types a claim can carry into a user-schema property.
 */
export const CLAIM_TYPES = ["string", "number", "integer", "boolean"] as const;

/**
 * The value type of a claim a mapping fills a property from.
 */
export type ClaimType = (typeof CLAIM_TYPES)[number];

/**
 * A user-schema property, as far as filling it from a claim is concerned.
 */
export type SchemaAttribute = {
  /**
   * The property's name.
   */
  readonly name: string;

  /**
   * The one scalar type it declares; `undefined` for an object, an array or an
   * untyped property, which no claim can fill.
   */
  readonly type: ClaimType | undefined;

  /**
   * Whether the server requires a user created from a provider to have it.
   */
  readonly required: boolean;

  /**
   * Whether two users cannot hold the same value of it.
   */
  readonly unique: boolean;
};

/**
 * One mapping: the schema property, the provider claim, and the claim's
 * declared type.
 */
export type ClaimEntry = {
  /**
   * The schema property the claim fills.
   */
  readonly attribute: string;

  /**
   * The claim the provider returns.
   */
  readonly claim: string;

  /**
   * What the provider returns. Left out, it is the standard's type, else a
   * string.
   */
  readonly type?: ClaimType;

  /**
   * The property does not exist yet: add it to the user schema, typed to hold
   * the claim, and map the claim to it.
   */
  readonly create?: boolean;
};

/**
 * How a property is verified: the boolean claim that says so, or `true` to
 * trust the provider.
 */
export type VerifiedEntry = {
  /**
   * The mapped property.
   */
  readonly attribute: string;

  /**
   * The claim that must be true, or `true` to trust the provider.
   */
  readonly source: string | true;
};

/**
 * Everything the developer asked for beyond the defaults.
 */
export type ClaimRequest = {
  /**
   * The claims to map.
   */
  readonly entries: readonly ClaimEntry[];

  /**
   * How the mapped properties are verified.
   */
  readonly verified: readonly VerifiedEntry[];

  /**
   * Extra scopes the provider needs before it returns the claims.
   */
  readonly scopes: readonly string[];
};

/**
 * A request that asks for nothing, so the provider's defaults stand.
 */
export const NO_CLAIM_REQUEST: ClaimRequest = {
  entries: [],
  verified: [],
  scopes: [],
};

/**
 * Where a mapping stands while it is built up and checked.
 */
export type MappingState = {
  /**
   * The properties of the user schema, and any the request adds.
   */
  readonly attributes: readonly SchemaAttribute[];

  /**
   * Schema property to claim.
   */
  readonly mapping: Readonly<Record<string, string>>;

  /**
   * Claim to the type it was declared with, for checking against the property.
   */
  readonly claimTypes: Readonly<Record<string, ClaimType>>;

  /**
   * Schema property to the claim that verifies it, or `true`.
   */
  readonly verified: Readonly<Record<string, string | true>>;

  /**
   * The scopes the connection requests.
   */
  readonly scopes: readonly string[];

  /**
   * Properties a request has mapped. A property the defaults mapped is not here
   * and a request may replace it; one in here is settled for this request.
   */
  readonly explicit: readonly string[];

  /**
   * Properties whose default was replaced and which had been verified by the
   * claim replaced.
   */
  readonly unverifiedByReplacing: readonly string[];

  /**
   * Properties the request adds to the user schema, so the commands can write
   * them.
   */
  readonly created: readonly SchemaAttribute[];
};

/**
 * The flag values a command parsed, before they are read as a request.
 */
export type ClaimFlagValues = {
  /**
   * Each `<property>=<claim>[:type]`.
   */
  readonly claim?: readonly string[] | undefined;

  /**
   * The extra scopes, separated by spaces or commas.
   */
  readonly scope?: string | undefined;

  /**
   * Each `<property>=<claim>` or `<property>=true`.
   */
  readonly verified?: readonly string[] | undefined;
};

/**
 * The flags that restate a request, in the words a suggested command carries.
 */
export type ClaimFlagTexts = {
  /**
   * Each claim, as `<property>=<claim>[:type]`.
   */
  readonly claim: string[] | undefined;

  /**
   * Each verification, as `<property>=<claim>` or `<property>=true`.
   */
  readonly verifiedClaim: string[] | undefined;

  /**
   * The extra scopes, separated by spaces.
   */
  readonly claimScope: string | undefined;
};

/**
 * The boolean claim that says the provider checked a standard claim.
 */
const VERIFIED_BY: ReadonlyMap<string, string> = new Map([
  ["email", "email_verified"],
  ["phone_number", "phone_number_verified"],
]);

/**
 * What a person might type for a type, and the type it means.
 */
const TYPE_ALIASES: Readonly<Partial<Record<string, ClaimType>>> = {
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
 * What a claim of a type can be stored in: a property of the same type, and an
 * integer in a number.
 */
const HELD_BY = {
  string: ["string"],
  number: ["number"],
  integer: ["integer", "number"],
  boolean: ["boolean"],
} as const satisfies Record<ClaimType, readonly ClaimType[]>;

/**
 * A parsed value.
 *
 * @param value - What was parsed.
 * @returns The success.
 */
function ok<T>(value: T): Parsed<T> {
  return {
    ok: true,
    value,
  };
}

/**
 * Text that does not parse.
 *
 * @param problem - What is wrong with it.
 * @returns The refusal.
 */
function refuse<T>(problem: string): Parsed<T> {
  return {
    ok: false,
    problem,
  };
}

/**
 * The values of both lists, each once, in the order met.
 *
 * @param lists - The lists.
 * @returns The union.
 */
function union(...lists: ReadonlyArray<readonly string[]>): readonly string[] {
  return [...new Set(lists.flat())];
}

/**
 * The standard's type for a claim OpenID Connect defines.
 *
 * @param claim - A claim name.
 * @returns The type, or `undefined` for a claim the standard does not define or
 *   one that is no scalar.
 */
export function standardClaimType(claim: string): ClaimType | undefined {
  const type = standardClaim(claim)?.type;
  return type === "object" ? undefined : type;
}

/**
 * The scope that makes a provider return a standard claim.
 *
 * @param claim - A claim name.
 * @returns The scope, or `undefined` for a claim the standard does not define.
 */
export function standardClaimScope(claim: string): string | undefined {
  return standardClaim(claim)?.scope;
}

/**
 * Whether a value of the claim's type can be stored in a property of the other.
 *
 * @param claim - The claim's type.
 * @param attribute - The property's type.
 * @returns Whether the property holds it.
 */
export function fits(claim: ClaimType, attribute: ClaimType): boolean {
  return HELD_BY[claim].some((held: ClaimType) => {
    return held === attribute;
  });
}

/**
 * `given_name` as `givenName`: the property a standard claim fills when the
 * names match.
 *
 * @param claim - A claim name.
 * @returns The property name.
 */
function propertyNameOf(claim: string): string {
  return claim.replace(/_([a-z])/g, (_, letter: string) => {
    return letter.toUpperCase();
  });
}

/**
 * The one scalar type a property declares.
 *
 * @param types - What the property declares; a nullable type lists `null` too.
 * @returns The type, or `undefined` for none, several, or one that is no scalar.
 */
function scalarType(types: readonly string[] | undefined): ClaimType | undefined {
  const real = (types ?? []).filter((type) => {
    return type !== "null";
  });
  return CLAIM_TYPES.find((type) => {
    return real.length === 1 && type === real[0];
  });
}

/**
 * The properties a user schema defines, as far as a claim can fill them.
 *
 * @param schema - The user schema.
 * @returns Each property, in the order the schema writes them.
 */
export function attributesOf(schema: UserSchema): readonly SchemaAttribute[] {
  const required = new Set(
    schema.requiredByServer.map((path) => {
      return path.split(".")[0];
    }),
  );
  return schema.propertyNames.map((name) => {
    return {
      name,
      type: scalarType(schema.findDeclaredTypes(name)),
      required: required.has(name),
      unique: schema.isUnique(name),
    };
  });
}

/**
 * A claim name as typed: one word, read from the top level of the claims.
 *
 * @param value - What was typed.
 * @returns The claim, or what is wrong with it.
 */
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

/**
 * A claim name no property is filled from yet.
 *
 * @param state - What is mapped so far.
 * @remarks
 * The property that uses the claim was read from a file, and the refusal is
 * drawn as the person types, so its name is escaped for the terminal.
 *
 * @param value - What was typed.
 * @returns The claim, or what is wrong with it, including what already uses it.
 */
export function parseUnusedClaim(state: MappingState, value: string): Parsed<string> {
  const claim = parseClaimName(value);
  if (!claim.ok) {
    return claim;
  }
  const holder = Object.entries(state.mapping).find(([, used]) => {
    return used === claim.value;
  })?.[0];
  return holder === undefined
    ? claim
    : refuse(
        `${claim.value} already fills ${escapeControlCharacters(holder, { keepLayout: false })}: a claim fills one property.`,
      );
}

/**
 * Scopes as typed, separated by spaces or commas. Nothing typed is none.
 *
 * @param value - What was typed.
 * @returns The scopes, each once.
 */
export function parseScopeList(value: string): Parsed<readonly string[]> {
  return ok(
    union(
      value.split(/[\s,]+/).filter((scope) => {
        return scope !== "";
      }),
    ),
  );
}

/**
 * What is wrong with a colon-word that nearly spells a type.
 *
 * @remarks
 * A namespaced claim (`urn:acme:roles`) also ends in a colon-word, so only a
 * near miss of a type is refused: the wrong case, or a common alias.
 *
 * @param rest - The claim as typed, after the equals sign.
 * @returns What to say, or `undefined` when the colon-word is no near miss.
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
      : (CLAIM_TYPES.find((type) => {
          return type === word;
        }) ?? TYPE_ALIASES[word]);
  return meant === undefined
    ? undefined
    : `:${typed} is not a type here. Did you mean :${meant}? The types are ${CLAIM_TYPES.join(", ")}, in lower case.`;
}

/**
 * `staffNumber=employee_id:integer`: the property, the claim and, after a
 * colon, the claim's type.
 *
 * @param text - What was typed.
 * @returns The entry, or what is wrong with it.
 */
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
  const type = CLAIM_TYPES.find((one) => {
    return one === typed?.[2];
  });
  return ok({
    attribute,
    claim: claim.value,
    ...(type === undefined ? {} : { type }),
  });
}

/**
 * `contactEmail=email_verified`, or `contactEmail=true` to trust the provider
 * for it.
 *
 * @param text - What was typed.
 * @returns The entry, or what is wrong with it.
 */
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
    return ok({
      attribute,
      source: true,
    });
  }
  if (rest.toLowerCase() === "true" || rest.toLowerCase() === "false") {
    return refuse(
      `${text}: ${rest.toLowerCase() === "true" ? "to trust the provider write exactly true" : "leave a property out of verification to leave it unverified"}.`,
    );
  }
  const claim = parseClaimName(rest);
  if (!claim.ok) {
    return refuse(`${text}: ${claim.problem}`);
  }
  return ok({
    attribute,
    source: claim.value,
  });
}

/**
 * Start from what a connection already maps, and add the standard claims whose
 * scope it requests and whose name matches a property of the schema, so a
 * schema with `givenName` or `picture` is filled without being asked.
 *
 * @remarks
 * A standard claim is only added when the connection already asks for its
 * scope: adding a scope the provider does not know would break its sign-in.
 *
 * @param connection - The connection the provider's defaults make.
 * @param schema - The user schema the connection signs people in to.
 * @returns The mapping the connection starts from.
 */
export function seedMapping(connection: Connection, schema: UserSchema): MappingState {
  const attributes = attributesOf(schema);
  const scopes = connection.scopes ?? [];
  const existing = Object.fromEntries(
    connection.mappings.map(({ property, claim }) => {
      return [property, claim];
    }),
  );
  const defaults = Object.entries(STANDARD_CLAIMS).flatMap(([claim, standard]) => {
    const type = standardClaimType(claim);
    const attribute = attributes.find((one) => {
      return one.name === propertyNameOf(claim);
    });
    const fillable =
      type !== undefined &&
      attribute?.type !== undefined &&
      fits(type, attribute.type) &&
      scopes.includes(standard.scope) &&
      !Object.hasOwn(existing, attribute.name) &&
      !Object.values(existing).includes(claim);
    return fillable ? [[attribute.name, claim] as const] : [];
  });
  const mapping = { ...existing, ...Object.fromEntries(defaults) };
  const given = Object.fromEntries(
    connection.verifications.flatMap(({ property, claim }) => {
      return typeof claim === "string" || claim === true ? [[property, claim] as const] : [];
    }),
  );
  const derived = Object.entries(mapping).flatMap(([attribute, claim]) => {
    const verifiedBy = VERIFIED_BY.get(claim);
    return verifiedBy === undefined || Object.hasOwn(given, attribute)
      ? []
      : [[attribute, verifiedBy] as const];
  });
  return {
    attributes,
    mapping,
    claimTypes: Object.fromEntries(
      Object.values(mapping).map((claim) => {
        return [claim, standardClaimType(claim) ?? "string"];
      }),
    ),
    verified: { ...given, ...Object.fromEntries(derived) },
    scopes,
    explicit: [],
    unverifiedByReplacing: [],
    created: [],
  };
}

/**
 * The properties no claim fills yet that a claim of this type could fill.
 *
 * @param state - What is mapped so far.
 * @param claimType - The claim's type.
 * @returns The properties.
 */
export function unmapped(state: MappingState, claimType: ClaimType): readonly SchemaAttribute[] {
  return state.attributes.filter((attribute) => {
    return (
      attribute.type !== undefined &&
      fits(claimType, attribute.type) &&
      !Object.hasOwn(state.mapping, attribute.name)
    );
  });
}

/**
 * A name for a property the request adds to the user schema.
 *
 * @remarks
 * The schema only forbids a dot, but the name is a JSON key and a field in the
 * login flow, so it is held to a plain identifier. It must not already be a
 * property.
 *
 * @param value - What was typed.
 * @param taken - The properties the schema already has.
 * @returns The name, or what is wrong with it.
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

/**
 * The label the login form shows for an attribute nobody has written text for:
 * the name split at capitals and underscores, in sentence case.
 *
 * @remarks
 * The login component does the same (`humaniseFieldName` in
 * `@zitadel/components`).
 *
 * @param name - The attribute's name.
 * @returns The label.
 */
export function fieldLabelFor(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return words === "" ? words : `${words[0]?.toUpperCase()}${words.slice(1)}`;
}

/**
 * A property as a message names it, with what it can hold.
 *
 * @param attribute - The property.
 * @returns The name and the type.
 */
function describe(attribute: SchemaAttribute): string {
  return `${attribute.name} (${attribute.type ?? "not a string, number, integer or boolean"})`;
}

/**
 * Map one claim to one property, or say why that is refused: the property is
 * not in the schema or is not a scalar, it is already filled, the claim
 * already fills another, or the claim's type does not fit the property's.
 *
 * @remarks
 * Replacing a default drops what verified the claim it replaced: that claim
 * said nothing about this one.
 *
 * @param state - What is mapped so far.
 * @param entry - The claim to map.
 * @returns The mapping with the claim in it, or why it is refused.
 */
export function mapClaim(state: MappingState, entry: ClaimEntry): Parsed<MappingState> {
  if (entry.create === true) {
    const name = parseNewAttributeName(
      entry.attribute,
      state.attributes.map((one) => {
        return one.name;
      }),
    );
    if (!name.ok) {
      return name;
    }
    const added: SchemaAttribute = {
      name: name.value,
      type: entry.type ?? standardClaimType(entry.claim) ?? "string",
      required: false,
      unique: false,
    };
    return mapClaim(
      {
        ...state,
        attributes: [...state.attributes, added],
        created: [...state.created, added],
      },
      {
        attribute: entry.attribute,
        claim: entry.claim,
        type: entry.type,
      },
    );
  }
  const attribute = state.attributes.find((one) => {
    return one.name === entry.attribute;
  });
  if (attribute === undefined) {
    return refuse(
      `${entry.attribute} is not a property of the user schema, which defines ${
        state.attributes
          .map((one) => {
            return one.name;
          })
          .join(", ") || "none"
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
  const claimFills = Object.entries(state.mapping).find(([property, claim]) => {
    return claim === entry.claim && property !== attribute.name;
  })?.[0];
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
  const replaced = filledBy !== undefined && filledBy !== entry.claim;
  const wasVerified = Object.hasOwn(state.verified, attribute.name);
  return ok({
    ...state,
    mapping,
    claimTypes: {
      ...Object.fromEntries(
        Object.entries(state.claimTypes).filter(([claim]) => {
          return Object.values(mapping).includes(claim);
        }),
      ),
      [entry.claim]: claimType,
    },
    verified: replaced
      ? Object.fromEntries(
          Object.entries(state.verified).filter(([property]) => {
            return property !== attribute.name;
          }),
        )
      : state.verified,
    explicit: [...state.explicit, attribute.name],
    unverifiedByReplacing:
      replaced && wasVerified
        ? [...state.unverifiedByReplacing, attribute.name]
        : state.unverifiedByReplacing,
  });
}

/**
 * What a person should hear about the state: a property whose default was
 * replaced and has not been given a verification since.
 *
 * @remarks
 * Worked out from the state, so verifying the property afterwards takes the
 * note away.
 *
 * @param state - What is mapped.
 * @param flag - The flag that says how a property is verified, as the command
 *   spells it.
 * @returns One note for each such property.
 */
export function claimNotes(state: MappingState, flag: string): readonly string[] {
  return state.unverifiedByReplacing
    .filter((attribute) => {
      return !Object.hasOwn(state.verified, attribute);
    })
    .map((attribute) => {
      return `${attribute} is now filled from ${state.mapping[attribute]} and is no longer verified, so a user whose ${attribute} must be unique is asked to confirm it at sign-up. Say how the provider verifies it with ${flag} ${attribute}=<claim> (or =true to trust the provider).`;
    });
}

/**
 * Say how a mapped property is verified. A property with no mapping has
 * nothing to verify, and the connection contract refuses a `verified_claims`
 * key without one.
 *
 * @param state - What is mapped so far.
 * @param entry - The verification.
 * @returns The mapping with the verification in it, or why it is refused.
 */
export function verifyAttribute(state: MappingState, entry: VerifiedEntry): Parsed<MappingState> {
  if (!Object.hasOwn(state.mapping, entry.attribute)) {
    return refuse(
      `${entry.attribute} has no claim mapping, so there is nothing to verify. Map it first.`,
    );
  }
  return ok({ ...state, verified: { ...state.verified, [entry.attribute]: entry.source } });
}

/**
 * Apply a request in order: the mappings, then their scopes, then how they are
 * verified.
 *
 * @param state - What the connection maps by default.
 * @param request - What the developer asked for.
 * @returns The mapping the request makes, or why it is refused.
 */
export function applyRequest(state: MappingState, request: ClaimRequest): Parsed<MappingState> {
  const mapped = request.entries.reduce<Parsed<MappingState>>((current, entry) => {
    return current.ok ? mapClaim(current.value, entry) : current;
  }, ok(state));
  if (!mapped.ok) {
    return mapped;
  }
  return request.verified.reduce<Parsed<MappingState>>(
    (current, entry) => {
      return current.ok ? verifyAttribute(current.value, entry) : current;
    },
    ok({ ...mapped.value, scopes: union(mapped.value.scopes, request.scopes) }),
  );
}

/**
 * The value of a parse, or an `E_VALIDATION` that says what to fix.
 *
 * @param parsed - What was parsed.
 * @returns The value.
 * @throws {@link ZitadelError} With `E_VALIDATION` when it did not parse.
 */
export function claimsOrRefuse<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) {
    throw new ZitadelError("E_VALIDATION", parsed.problem, {
      hint: "Fix the claim mapping and run the command again.",
    });
  }
  return parsed.value;
}

/**
 * Read the flags as a request.
 *
 * @remarks
 * Each flag checked its own shape as it was parsed, so what is read here
 * parses. Whether an entry fits the schema is for {@link applyRequest}, which
 * needs the schema.
 *
 * @param values - What the flags carried.
 * @returns The request.
 */
export function claimRequestFromFlags(values: ClaimFlagValues): ClaimRequest {
  return {
    entries: (values.claim ?? []).map((text) => {
      return validated(parseClaimEntry(text));
    }),
    verified: (values.verified ?? []).map((text) => {
      return validated(parseVerifiedEntry(text));
    }),
    scopes: validated(parseScopeList(values.scope ?? "")),
  };
}

/**
 * What a mapping makes of a connection: the claims, how they are verified, the
 * scopes, the attributes it creates, and what the developer should hear.
 *
 * @param state - What is mapped.
 * @param flag - The flag that says how a property is verified, as the command
 *   spells it, which the notes name.
 * @returns What the connection is written with.
 */
export function choiceOf(state: MappingState, flag: string): ClaimChoice {
  return {
    mapping: state.mapping,
    verified: state.verified,
    scopes: state.scopes,
    created: state.created.map((attribute) => {
      return {
        name: attribute.name,
        type: attribute.type ?? "string",
      };
    }),
    notes: claimNotes(state, flag),
  };
}

/**
 * Whether a request asks for anything.
 *
 * @param request - The request.
 * @returns Whether it has a claim, a verification or a scope.
 */
export function asksForClaims(request: ClaimRequest): boolean {
  return request.entries.length + request.verified.length + request.scopes.length > 0;
}

/**
 * The flags that restate a request, for a command offered as text.
 *
 * @param request - The request.
 * @returns What each flag carries, `undefined` for one the request leaves out.
 */
export function claimFlagTexts(request: ClaimRequest): ClaimFlagTexts {
  return {
    claim:
      request.entries.length === 0
        ? undefined
        : request.entries.map((entry) => {
            return `${entry.attribute}=${entry.claim}${entry.type === undefined ? "" : `:${entry.type}`}`;
          }),
    verifiedClaim:
      request.verified.length === 0
        ? undefined
        : request.verified.map((entry) => {
            return `${entry.attribute}=${entry.source}`;
          }),
    claimScope: request.scopes.length === 0 ? undefined : request.scopes.join(" "),
  };
}
