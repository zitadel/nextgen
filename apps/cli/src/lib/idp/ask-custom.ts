import {
  DEFAULT_SCOPES,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  RESERVED_SLUGS,
} from "@zitadel/config/idp";

import type { Asker } from "../input";
import type { CustomFlagValues } from "./custom";

/**
 * The settings of a custom connection, asking only for the ones not already
 * given — the way `--preset` skips its own question and no other. A given
 * value goes through the same parser as a typed one, so every setting comes
 * back checked against the contract the server enforces on apply, and a name
 * or issuer it would refuse is refused. The command line's own mistakes are
 * named under their flag before this runs (`checkGivenCustomFlags`), so a
 * given value that gets here has already passed.
 */
export async function askCustomSettings(
  given: CustomFlagValues,
  ask: Asker,
): Promise<Required<CustomFlagValues>> {
  const slug = await ask({
    kind: "text",
    name: "connection name",
    message:
      "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
    parse: (value) => parseConnectionSlug(value, RESERVED_SLUGS),
    given: given.slug,
  });
  const displayName = await ask({
    kind: "text",
    name: "display name",
    message: "What name should the sign-in button show? For example Acme SSO.",
    parse: parseDisplayName,
    given: given.displayName,
  });
  const issuer = await ask({
    kind: "text",
    name: "issuer",
    message: "What is the issuer URL of the provider?",
    parse: parseIssuer,
    given: given.issuer,
  });
  const scopes = await ask({
    kind: "text",
    name: "scopes",
    message: "Which scopes should we request? Separate them with spaces.",
    parse: parseScopes,
    given: given.scopes,
    initialValue: DEFAULT_SCOPES.join(" "),
  });
  // The settings carry the scopes as the one string a flag does.
  return { slug, displayName, issuer, scopes: scopes.join(" ") };
}
