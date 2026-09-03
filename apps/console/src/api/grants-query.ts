import { customFetch } from "@zitadel/api/runtime/fetch";
import { getProxyPath } from "@zitadel/api/runtime/base-url";

/**
 * `POST /grants/query`, hand-written because the operation is not generated yet.
 *
 * **This file is a stand-in and is meant to be deleted.** The endpoint is
 * landing in #1118; until its OpenAPI reaches `main`, orval generates no
 * `queryGrants`, so the Admins screen would have no way to list. Rather than
 * hold the screen back, the one missing call is written by hand here and
 * nowhere else — every other grant call on the screen uses the generated
 * client.
 *
 * It goes through the same `customFetch` and `getProxyPath` the generated
 * operations use, so auth, the non-2xx `ApiError` throw and body parsing behave
 * identically. Swapping it out is an import change:
 *
 *   1. `moon run api:build` once #1118 is on `main`
 *   2. replace `queryGrants` here with `api.queryGrants`
 *   3. delete this file
 *
 * The types mirror #1118's contract and are narrowed to what the screen
 * renders — a wider hand-copy would only be a second place to drift.
 */

/** The relations the grant catalog defines on `object_type` `project`. */
export type GrantRelation = "viewer" | "editor" | "admin";

/**
 * The principal a grant binds, as `expand: ["principal"]` embeds it: the body
 * `GET /users/{id}` serves for a user, or `GET /teams/{id}` for a team.
 * Narrowed here to the identity fields the table renders (ADR 058), plus the
 * team `name`, and read defensively because the two shapes share one property.
 */
export interface GrantPrincipal {
  id?: string;
  /** Users: the resolved identifier, e.g. the designated email. */
  identifier?: string;
  /** Users: the resolved display name, when the schema designates one. */
  display?: string;
  /** Teams: the team's name. */
  name?: string;
}

export interface Grant {
  id: string;
  principal_type: "user" | "team";
  principal_id: string;
  relation: GrantRelation;
  created_at: string;
  expires_at?: string | null;
  /**
   * Present only when the request asked for it, and `null` when the principal
   * could not be loaded — a deleted user leaves its grant behind.
   */
  principal?: GrantPrincipal | null;
}

export interface QueryGrantsResponse {
  grants: Grant[];
  next_page_token?: string | null;
}

export interface QueryGrantsBody {
  limit?: number;
  page_token?: string;
  expand?: "principal"[];
}

export async function queryGrants(
  body: QueryGrantsBody,
  params: { project_id: string },
): Promise<QueryGrantsResponse> {
  const query = new URLSearchParams({ project_id: params.project_id });
  return customFetch<QueryGrantsResponse>(`${getProxyPath()}/grants/query?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
