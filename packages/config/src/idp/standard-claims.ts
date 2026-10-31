/** The JSON type of a claim's value, as OpenID Connect Core defines it. */
export type ClaimType = "string" | "number" | "boolean" | "object";

/** A standard claim: the scope that makes a provider return it, and the type of its value. */
export type StandardClaim = {
  readonly scope: "profile" | "email" | "address" | "phone";
  readonly type: ClaimType;
};

/**
 * The claims OpenID Connect Core 5.4 defines, with the scope that returns each
 * and the type of its value. What a connection maps by default is drawn from
 * here, and `deploy` judges a mapping against it: a standard claim is the one
 * kind whose scope and type are known without signing in.
 *
 * A claim not listed here (anything a provider adds) is unknowable until a
 * real sign-in, so nothing is said about it.
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

/** The standard claim with this name, or `undefined` for any other. */
export function standardClaim(name: string): StandardClaim | undefined {
  return Object.hasOwn(STANDARD_CLAIMS, name) ? STANDARD_CLAIMS[name] : undefined;
}
