import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "@/api/zitadel";

import { field } from "./record";
import { toUserRow, type UserRow } from "./user-list";

type UsersPage = Awaited<ReturnType<typeof api.queryUsers>>;
type UserFilter = NonNullable<Parameters<typeof api.queryUsers>[0]["filter"]>;

/**
 * The two ways a user relates to a team (ADR 024), the two values of the
 * filter on the team's Users tab:
 *
 *   - `members`: users holding an active membership — who collaborates in it.
 *   - `owned`: users whose identity lifecycle the team owns — who it may
 *     deprovision.
 *
 * Neither implies the other, and `POST /users/query` combines filters with AND
 * only, so each is its own query with its own page token rather than one list
 * merged from two.
 */
export type TeamUserRelation = "members" | "owned";

/** Same page size as the Users screen. */
const PAGE_SIZE = 25;

/**
 * The filter for one relation. `team_id` reads memberships, so it needs
 * `team_membership.read` like `expand: ["teams"]` does, and is refused the same
 * way to a grant on only part of the project. `lifecycle_owner_team_id` is a
 * column on the user and needs only `user.read`.
 */
function relationFilter(relation: TeamUserRelation, teamId: string): UserFilter {
  return [
    {
      field: relation === "members" ? "team_id" : "lifecycle_owner_team_id",
      operation: "equals",
      value: teamId,
    },
  ];
}

/** One page of a team's users, with the list state it carries besides its rows. */
export interface TeamUsersPage {
  items: Record<string, unknown>[];
  nextPageToken?: string;
  /** Whether the page embeds each user's lifecycle owner team. */
  ownersExpanded: boolean;
}

/**
 * One page of a team's users in one relation.
 *
 * The members view embeds each user's lifecycle owner, so a member owned by
 * another team says so. `expand: ["lifecycle_owner_team"]` needs `team.read`
 * on top of `user.read`, and a credential without it is refused the whole
 * request (ADR 059); the refusal falls back to the unexpanded read, which still
 * carries `metadata.lifecycle_owner_team_id`, so the column shows the owner's
 * id instead of its name. The owned view asks for nothing: every row's owner is
 * this team, which the id alone tells.
 *
 * `expand` is false once a page was served without the expansion, so Load more
 * does not ask to be refused again — the same contract as `fetchUsers`. A 403
 * on the unexpanded read is the relation itself being refused, and propagates.
 */
export async function fetchTeamUsers(
  projectId: string,
  teamId: string,
  relation: TeamUserRelation,
  pageToken?: string,
  expand = relation === "members",
): Promise<TeamUsersPage> {
  const body = {
    limit: PAGE_SIZE,
    page_token: pageToken,
    filter: relationFilter(relation, teamId),
  };
  const params = { project_id: projectId };
  const toPage = (page: UsersPage, ownersExpanded: boolean): TeamUsersPage => ({
    items: page.users,
    nextPageToken: page.next_page_token ?? undefined,
    ownersExpanded,
  });
  if (!expand) return toPage(await api.queryUsers(body, params), false);
  try {
    return toPage(
      await api.queryUsers({ ...body, expand: ["lifecycle_owner_team"] }, params),
      true,
    );
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 403) throw cause;
    return toPage(await api.queryUsers(body, params), false);
  }
}

/**
 * Who owns a user's lifecycle, relative to the team on screen:
 *
 *   - `self`: the user owns their own lifecycle (`lifecycle_owner_team_id` is null).
 *   - `this`: the team on screen.
 *   - `other`: another team — named when the expansion resolved it, and only
 *     its id otherwise.
 *
 * `unknown` is a record the server stamped no owner field on at all, which is
 * not the same as self-owned and so is not rendered as it.
 */
export type LifecycleOwner =
  | { kind: "self" }
  | { kind: "this" }
  | { kind: "other"; teamId: string; name?: string }
  | { kind: "unknown" };

export function lifecycleOwner(user: Record<string, unknown>, teamId: string): LifecycleOwner {
  const metadata = user.metadata;
  if (!metadata || typeof metadata !== "object") return { kind: "unknown" };
  const record = metadata as Record<string, unknown>;
  if (!("lifecycle_owner_team_id" in record)) return { kind: "unknown" };
  const ownerId = field(record, "lifecycle_owner_team_id");
  if (!ownerId) return { kind: "self" };
  if (ownerId === teamId) return { kind: "this" };
  const owner = record.lifecycle_owner_team;
  const name =
    owner && typeof owner === "object"
      ? field(owner as Record<string, unknown>, "name")
      : undefined;
  return { kind: "other", teamId: ownerId, name };
}

/** A user table row plus who owns the user's lifecycle. */
export type TeamUserRow = UserRow & { owner: LifecycleOwner };

export function toTeamUserRow(
  user: Record<string, unknown>,
  index: number,
  teamId: string,
): TeamUserRow {
  return { ...toUserRow(user, index, []), owner: lifecycleOwner(user, teamId) };
}
