// Tests build the values the parsers produce, for inputs they already know are valid.
import type {
  CatalogProviderId,
  ClientId,
  ClientIdVariable,
  ClientSecret,
  ClientSecretVariable,
  ConnectionSlug,
  DisplayName,
  Issuer,
  ProviderSelection,
  Scopes,
} from "@zitadel/config/idp";

export const slug = (value: string) => value as ConnectionSlug;
export const displayName = (value: string) => value as DisplayName;
export const issuer = (value: string) => value as Issuer;
export const clientId = (value: string) => value as ClientId;
export const clientSecret = (value: string) => value as ClientSecret;
export const idVariable = (value: string) => value as ClientIdVariable;
export const secretVariable = (value: string) => value as ClientSecretVariable;

/** The Google provider, as a command or an answer names it. */
export const googleSelection: ProviderSelection = {
  kind: "catalog",
  id: "google" as CatalogProviderId,
};

/** A custom connection, as a command or an answer describes one. */
export const acmeSelection = {
  kind: "custom" as const,
  connection: {
    slug: slug("acme"),
    displayName: displayName("Acme SSO"),
    issuer: issuer("https://sso.acme.example"),
    scopes: ["openid", "profile", "email"] as Scopes,
  },
} satisfies ProviderSelection;
