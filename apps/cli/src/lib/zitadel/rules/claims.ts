/**
 * The JSON type of a claim's value, as OpenID Connect Core defines it.
 */
export type ClaimType = "string" | "number" | "boolean" | "object";

/**
 * A standard claim: the scope that makes a provider return it, and the type
 * of its value.
 */
export type StandardClaim = Readonly<{
  /**
   * The scope that makes a provider return the claim.
   */
  scope: "profile" | "email" | "address" | "phone";
  /**
   * The JSON type of the claim's value.
   */
  type: ClaimType;
}>;

/**
 * The claims OpenID Connect Core 5.4 defines.
 *
 * @remarks
 * A claim not listed here, such as anything a provider adds, is unknowable
 * until a real sign-in, so nothing is said about it.
 */
export const STANDARD_CLAIMS: Readonly<Record<string, StandardClaim>> = {
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
};

/**
 * The scopes OpenID Connect itself defines, which return only the standard
 * claims.
 */
export const STANDARD_SCOPES: ReadonlySet<string> = new Set([
  "openid",
  "profile",
  "email",
  "address",
  "phone",
  "offline_access",
]);

/**
 * The JSON types a schema property may declare for a claim of each type to
 * fit it.
 */
export const FITS: Readonly<Record<ClaimType, readonly string[]>> = {
  string: ["string"],
  boolean: ["boolean"],
  number: ["number", "integer"],
  object: ["object"],
};

/**
 * The standard claim with this name.
 *
 * @param claim - A claim as a mapping names it.
 * @returns The claim's scope and type, or `undefined` for any other claim.
 */
export function standardClaim(claim: unknown): StandardClaim | undefined {
  if (typeof claim !== "string" || !Object.hasOwn(STANDARD_CLAIMS, claim)) {
    return undefined;
  }
  return STANDARD_CLAIMS[claim];
}
