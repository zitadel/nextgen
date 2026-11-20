import { type Parsed, validated } from "@zitadel/config/idp";

import { ZitadelError } from "@/lib/errors";
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
 * The boolean claim that says the provider checked a standard claim.
 */
const VERIFIED_BY: ReadonlyMap<string, string> = new Map([
  ["email", "email_verified"],
  ["phone_number", "phone_number_verified"],
]);

/**
 * One scope token as RFC 6749 section 3.3 spells it: printable ASCII without
 * the space, the double quote and the backslash.
 */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

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
  if (standardClaim(claim)?.type === "object") {
    return refuse(
      `${claim} is an object claim in OpenID Connect, which no single property can hold.`,
    );
  }
  return ok(claim);
}

/**
 * Scopes as typed, separated by spaces or commas. Nothing typed is none.
 *
 * @remarks
 * A scope is sent to the provider in the authorization request, so each one
 * must be a token of the OAuth scope grammar.
 *
 * @param value - What was typed.
 * @returns The scopes, each once, or the first that is no scope token.
 */
export function parseScopeList(value: string): Parsed<readonly string[]> {
  const typed = value.split(/[\s,]+/).filter((scope) => {
    return scope !== "";
  });
  const invalid = typed.find((scope) => {
    return !SCOPE_TOKEN.test(scope);
  });
  return invalid === undefined
    ? ok(union(typed))
    : refuse(
        `${invalid} is not a valid scope: a scope is printable ASCII without quotes or backslashes.`,
      );
}

/**
 * The two sides of the first equals sign of a flag's value, each trimmed.
 *
 * @param text - What was typed.
 * @returns The property and what follows the sign; both empty when there is no
 *   sign or nothing before it.
 */
function splitAtEquals(text: string): { readonly attribute: string; readonly rest: string } {
  const at = text.indexOf("=");
  return {
    attribute: at < 1 ? "" : text.slice(0, at).trim(),
    rest: at < 1 ? "" : text.slice(at + 1).trim(),
  };
}

/**
 * `staffNumber=employee_id:integer`: the property, the claim and, after a
 * colon, the claim's type.
 *
 * @remarks
 * A namespaced claim (`urn:acme:roles`) also ends in a colon-word, so only a near miss of a
 * type is refused: the wrong case, or a common alias.
 *
 * @param text - What was typed.
 * @returns The entry, or what is wrong with it.
 */
export function parseClaimEntry(text: string): Parsed<ClaimEntry> {
  const { attribute, rest } = splitAtEquals(text);
  if (attribute === "" || rest === "") {
    return refuse(
      `"${text}" is not <property>=<claim>, e.g. staffNumber=employee_id:integer or contactEmail=mail.`,
    );
  }
  const typed = /^(.+):(string|number|integer|boolean)$/.exec(rest);
  const typedWord = /:([A-Za-z]+)$/.exec(rest)?.[1];
  const word = typedWord?.toLowerCase();
  const meant =
    word === undefined
      ? undefined
      : (CLAIM_TYPES.find((type) => {
          return type === word;
        }) ?? TYPE_ALIASES[word]);
  const misspelt =
    typed !== null
      ? undefined
      : rest.startsWith(":") || rest.endsWith(":")
        ? "A claim name does not start or end with a colon."
        : meant === undefined
          ? undefined
          : `:${typedWord} is not a type here. Did you mean :${meant}? The types are ${CLAIM_TYPES.join(", ")}, in lower case.`;
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
  const { attribute, rest } = splitAtEquals(text);
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
 * The properties are those the schema defines, as far as a claim can fill them: the one
 * scalar type each declares, which a nullable type reduces to its real one, and whether it is
 * required and unique. A standard claim fills the property that bears its name in camel case, as
 * `given_name` fills `givenName`.
 *
 * A standard claim is only added when the connection requests its scope, or
 * the request adds it: adding a scope the provider does not know would break
 * its sign-in. What the connection already maps is held to the same rules, so a
 * standard claim whose scope is not requested, or whose type the property would
 * not hold, is dropped together with how it was verified.
 *
 * @param connection - The connection the provider's defaults make.
 * @param schema - The user schema the connection signs people in to.
 * @param requested - The extra scopes the request asks for, which the defaults
 *   are read against too.
 * @returns The mapping the connection starts from.
 */
export function seedMapping(
  connection: Connection,
  schema: UserSchema,
  requested: readonly string[] = [],
): MappingState {
  const required = new Set(
    schema.requiredByServer.map((path) => {
      return path.split(".")[0];
    }),
  );
  const attributes: readonly SchemaAttribute[] = schema.propertyNames.map((name) => {
    const declared = (schema.findDeclaredTypes(name) ?? []).filter((type) => {
      return type !== "null";
    });
    return {
      name,
      type: CLAIM_TYPES.find((type) => {
        return declared.length === 1 && type === declared[0];
      }),
      required: required.has(name),
      unique: schema.isUnique(name),
    };
  });
  const scopes = union(connection.scopes ?? [], requested);
  const existing = Object.fromEntries(
    connection.mappings
      .filter(({ property, claim }) => {
        const standard = standardClaim(claim);
        const type = standardClaimType(claim);
        const held = attributes.find((one) => {
          return one.name === property;
        })?.type;
        return (
          standard === undefined ||
          (scopes.includes(standard.scope) &&
            (type === undefined || held === undefined || fits(type, held)))
        );
      })
      .map(({ property, claim }) => {
        return [property, claim];
      }),
  );
  const defaults = Object.entries(STANDARD_CLAIMS).flatMap(([claim, standard]) => {
    const type = standardClaimType(claim);
    const property = claim.replace(/_([a-z])/g, (_, letter: string) => {
      return letter.toUpperCase();
    });
    const attribute = attributes.find((one) => {
      return one.name === property;
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
      return Object.hasOwn(mapping, property) && (typeof claim === "string" || claim === true)
        ? [[property, claim] as const]
        : [];
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
 * A name for a property the request adds to the user schema.
 *
 * @remarks
 * The schema only forbids a dot, but the name is a JSON key and a field in the
 * login flow, so it is held to a plain identifier. It must not already be a
 * property, nor a name every object has, such as `constructor`, which the
 * mappings would read as already there.
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
  if (Object.hasOwn(Object.prototype, name)) {
    return refuse(`"${name}" is a name every object already has, so it cannot be an attribute.`);
  }
  return taken.includes(name) ? refuse(`"${name}" is already a user attribute.`) : ok(name);
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
    const created = entry.type ?? standardClaimType(entry.claim) ?? "string";
    if (created !== "string") {
      return refuse(
        `${entry.claim} is a ${created} claim, but the login form submits a new attribute as text. Add a ${created} property to the user schema yourself and map the claim to it.`,
      );
    }
    const added: SchemaAttribute = {
      name: name.value,
      type: created,
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
      `${entry.claim} is a ${claimType} claim and ${attribute.name} (${attribute.type}) would not hold it.${hint}`,
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
 * Apply a request in order: the mappings, then their scopes, then how they are
 * verified.
 *
 * @remarks
 * A property with no mapping has nothing to verify, and the connection contract refuses a
 * `verified_claims` key without one.
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
      if (!current.ok) {
        return current;
      }
      if (!Object.hasOwn(current.value.mapping, entry.attribute)) {
        return refuse(
          `${entry.attribute} has no claim mapping, so there is nothing to verify. Map it first.`,
        );
      }
      return ok({
        ...current.value,
        verified: { ...current.value.verified, [entry.attribute]: entry.source },
      });
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
 * @param values - What the flags carried: each `<property>=<claim>[:type]`, the extra scopes
 *   separated by spaces or commas, and each `<property>=<claim>` or `<property>=true`.
 * @returns The request.
 */
export function claimRequestFromFlags(
  values: Readonly<{
    claim?: readonly string[] | undefined;
    scope?: string | undefined;
    verified?: readonly string[] | undefined;
  }>,
): ClaimRequest {
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
 * @remarks
 * What the developer should hear is worked out from the state, so verifying a property whose
 * default was replaced afterwards takes its note away.
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
    notes: [
      ...state.unverifiedByReplacing
        .filter((attribute) => {
          return !Object.hasOwn(state.verified, attribute);
        })
        .map((attribute) => {
          return `${attribute} is now filled from ${state.mapping[attribute]} and is no longer verified, so a user whose ${attribute} must be unique is asked to confirm it at sign-up. Say how the provider verifies it with ${flag} ${attribute}=<claim> (or =true to trust the provider).`;
        }),
      ...state.created.map((attribute) => {
        return `${attribute.name} is a new optional attribute, so a user the provider sends no ${state.mapping[attribute.name]} for can sign up without it and may never be asked for it.`;
      }),
    ],
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
export function claimFlagTexts(request: ClaimRequest): Readonly<{
  claim: string[] | undefined;
  verifiedClaim: string[] | undefined;
  claimScope: string | undefined;
}> {
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
