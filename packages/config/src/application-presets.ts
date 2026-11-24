import type { PublishApplicationBodyApplication } from "@zitadel/api/generated/model";

/** The application presets, by name. */
export const APPLICATION_PRESETS = ["web"] as const;

/**
 * A web application with one confidential OAuth client that signs users in
 * with the authorization code grant. The preset is only a starting point for
 * the caller to edit: it is not stored, and nothing remembers which preset made
 * a document. It leaves out `client_id` and the client secret because whoever
 * writes the document supplies them: through `POST /applications` the server
 * generates the id of a new client and issues its first secret. It also leaves
 * out `refresh_token`, `first_party` and a client `name`, which the developer
 * adds when wanted. It drops duplicate redirect URIs. The schema and the server
 * validate the inputs.
 */
export function webApplication({
  slug,
  name,
  redirectUris,
}: {
  slug: string;
  name: string;
  redirectUris: [string, ...string[]];
}): PublishApplicationBodyApplication {
  return {
    slug,
    name,
    clients: [
      {
        slug: "web",
        type: "confidential",
        grant_types: ["authorization_code"],
        redirect_uris: [...new Set(redirectUris)],
      },
    ],
  };
}
