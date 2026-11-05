import { toUserRow, type UserRow } from "@/features/users/list";
import { field } from "@/lib/record";

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
