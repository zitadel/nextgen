import type { PublishApplicationBodyApplication } from "@zitadel/api/generated/model";

/** The application presets, by name. */
export const APPLICATION_PRESETS = ["web"] as const;

/**
 * A web application with one confidential OAuth client that signs users in
 * with the authorization code grant. The preset is only a starting point for
 * the caller to edit: it is not stored, and nothing remembers which preset made
 * a document. Without `declared` it is the document `POST /applications`
 * registers: the server generates the client's id and issues its first
 * secret. With `declared` it is a file a release declares, whose client sets
 * the given `client_id` and names its secret as the project variable
 * `secretVariable`, written as a `${{ NAME }}` reference. It leaves out
 * `refresh_token`, `first_party` and a client `name`, which the developer adds
 * when wanted. It drops duplicate redirect URIs. The schema and the server
 * validate the inputs.
 */
export function webApplication({
  slug,
  name,
  redirectUris,
  declared,
}: {
  slug: string;
  name: string;
  redirectUris: [string, ...string[]];
  declared?: { clientId: string; secretVariable: string };
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
        ...(declared === undefined
          ? {}
          : {
              client_id: declared.clientId,
              secret: `\${{ ${declared.secretVariable} }}`,
            }),
      },
    ],
  };
}
