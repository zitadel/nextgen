import type { GetApplication200 } from "@zitadel/api/generated/model";

/** An application at its newest revision, as `GET /applications/{id}` returns it. */
export type Application = GetApplication200;

/** One OAuth client of an application's document. */
export type ApplicationClient = Application["definition"]["clients"][number];

type GrantType = ApplicationClient["grant_types"][number];

/**
 * A grant type as the screen names it. Keyed by the API's enum, so a grant
 * type added to the contract fails the build here instead of reading as its
 * wire name.
 */
const GRANT_TYPE_LABELS: Record<GrantType, string> = {
  authorization_code: "Authorization code",
  refresh_token: "Refresh token",
};

export function grantTypeLabel(grantType: GrantType): string {
  return GRANT_TYPE_LABELS[grantType];
}

/** A client type as the screen names it. */
const CLIENT_TYPE_LABELS: Record<ApplicationClient["type"], string> = {
  confidential: "Confidential",
  public: "Public",
};

export function clientTypeLabel(type: ApplicationClient["type"]): string {
  return CLIENT_TYPE_LABELS[type];
}

/**
 * Where an application is written, as the Source badge names it: `Code` for
 * one a release declares from a file, `Registered` for one created through
 * `POST /applications`.
 */
export function applicationSourceLabel(declared: boolean): string {
  return declared ? "Code" : "Registered";
}
