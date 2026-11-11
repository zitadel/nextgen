import type { JsonValue } from "@/lib/zitadel/types";

/**
 * The JSON types of a claim's value, as OpenID Connect Core defines them.
 */
export const CLAIM_TYPES = ["string", "number", "boolean", "object"] as const;

/**
 * The JSON type of a claim's value.
 */
export type ClaimType = (typeof CLAIM_TYPES)[number];

/**
 * The scopes that make a provider return a standard claim.
 */
export const CLAIM_SCOPES = ["profile", "email", "address", "phone"] as const;

/**
 * A scope that makes a provider return a standard claim.
 */
export type ClaimScope = (typeof CLAIM_SCOPES)[number];

/**
 * A standard claim: the scope that makes a provider return it, and the type
 * of its value.
 */
export type StandardClaim = {
  /**
   * The scope that makes a provider return the claim.
   */
  readonly scope: ClaimScope;

  /**
   * The JSON type of the claim's value.
   */
  readonly type: ClaimType;
};

/**
 * The claims OpenID Connect Core 5.4 defines.
 *
 * @remarks
 * A claim not listed here, such as anything a provider adds, is unknowable
 * until a real sign-in, so nothing is said about it.
 */
export const STANDARD_CLAIMS = {
  name: { scope: "profile", type: "string" },
  family_name: { scope: "profile", type: "string" },
  given_name: { scope: "profile", type: "string" },
  middle_name: { scope: "profile", type: "string" },
  nickname: { scope: "profile", type: "string" },
  preferred_username: { scope: "profile", type: "string" },
  profile: { scope: "profile", type: "string" },
  picture: { scope: "profile", type: "string" },
  website: { scope: "profile", type: "string" },
  gender: { scope: "profile", type: "string" },
  birthdate: { scope: "profile", type: "string" },
  zoneinfo: { scope: "profile", type: "string" },
  locale: { scope: "profile", type: "string" },
  updated_at: { scope: "profile", type: "number" },
  email: { scope: "email", type: "string" },
  email_verified: { scope: "email", type: "boolean" },
  address: { scope: "address", type: "object" },
  phone_number: { scope: "phone", type: "string" },
  phone_number_verified: { scope: "phone", type: "boolean" },
} as const satisfies Record<string, StandardClaim>;

/**
 * The name of a claim OpenID Connect Core defines.
 */
export type StandardClaimName = keyof typeof STANDARD_CLAIMS;

/**
 * The scopes OpenID Connect itself defines, which return only the standard
 * claims.
 */
export const STANDARD_SCOPES = ["openid", ...CLAIM_SCOPES, "offline_access"] as const;

/**
 * The JSON types a schema property may declare for a claim of each type to
 * fit it.
 */
export const FITS = {
  string: ["string"],
  boolean: ["boolean"],
  number: ["number", "integer"],
  object: ["object"],
} as const satisfies Record<ClaimType, readonly string[]>;

/**
 * Whether a name is one of the claims OpenID Connect Core defines.
 *
 * @param claim - A claim name.
 * @returns Whether it is a standard claim.
 */
export function isStandardClaim(claim: string): claim is StandardClaimName {
  return Object.hasOwn(STANDARD_CLAIMS, claim);
}

/**
 * Whether a scope is one OpenID Connect itself defines.
 *
 * @param scope - A scope as a connection asks for it.
 * @returns Whether it is a standard scope.
 */
export function isStandardScope(scope: string): boolean {
  return STANDARD_SCOPES.some((standard) => {
    return standard === scope;
  });
}

/**
 * Whether a JSON type a schema declares fits a claim of a type.
 *
 * @param claim - The claim's type.
 * @param declared - The type the schema declares.
 * @returns Whether the claim's value fits it.
 */
export function fits(claim: ClaimType, declared: string): boolean {
  return FITS[claim].some((accepted: string) => {
    return accepted === declared;
  });
}

/**
 * The standard claim with this name.
 *
 * @param claim - A claim as a mapping names it.
 * @returns The claim's scope and type, or `undefined` for any other claim.
 */
export function standardClaim(claim: JsonValue | undefined): StandardClaim | undefined {
  if (typeof claim !== "string" || !isStandardClaim(claim)) {
    return undefined;
  }
  return STANDARD_CLAIMS[claim];
}
