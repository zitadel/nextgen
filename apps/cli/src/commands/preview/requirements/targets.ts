import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ZitadelClient } from "../../../lib/api-client";
import { requirement, unmet } from "../../../lib/oclif/requirements";

/** The URLs among `urls` that are primary origins, which a preview must never reach. */
function productionUrls(urls: readonly string[], primaries: readonly string[]): string[] {
  return urls.filter((url) => primaries.includes(url));
}

/**
 * The project's primary origins, or none when the preview token may not read
 * the project (403): the server then decides alone what the token can deploy
 * to. A 401 is a token the server does not accept at all, which fails here
 * rather than after the whole bundle is built.
 */
async function primaryOrigins(client: ZitadelClient, projectId: string): Promise<string[]> {
  try {
    const project = await client.getProject(projectId);
    return project.origins
      .filter((entry) => entry.kind === "primary")
      .map((entry) => entry.pattern);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return [];
    }
    throw error;
  }
}

/**
 * The preview URLs, none of them a primary origin: an exact primary origin is
 * production as surely as the `primary` keyword is. The server is the authority
 * on what the preview token may reach; this catches the mistake before anything
 * is built, whenever the token can read the project's origins.
 */
export const previewTargets = requirement<readonly string[]>({
  refusal: {
    message: "{origins} is a primary origin",
    hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
  },
  resolve: async ({ resolved, connect }) => {
    const urls = resolved.urls as readonly string[];
    const { client, projectId } = await connect();
    const production = productionUrls(urls, await primaryOrigins(client, projectId));
    if (production.length > 0) {
      return unmet({
        origins: production.join(", "),
      });
    }
    return urls;
  },
});
