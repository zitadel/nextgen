import type { api } from "@/api/zitadel";

export type Member = Awaited<ReturnType<typeof api.listProjectMembers>>["members"][number];
export type Grant = Awaited<ReturnType<typeof api.queryGrants>>["grants"][number];
type Relation = Grant["relation"];

/** A stronger role includes the weaker ones (root ADR 086 §6). */
const STRENGTH: Record<Relation, number> = { viewer: 0, editor: 1, admin: 2 };

/** When a row's access ends: never, on a date, or already. */
export type Expiry = { kind: "never" } | { kind: "on"; at: string } | { kind: "expired" };

/** What a row's menu offers, from the grants it can revoke. */
export type RowAction =
  | { kind: "remove-access"; grantIds: string[] }
  | { kind: "remove-role"; grantIds: string[]; role: Relation; keeps: Relation };

/** A person as the table names them. */
export interface Person {
  userId: string;
  name: string;
  /** The identifier, under a display name; absent when the name is the identifier. */
  secondary?: string;
}

interface PersonRow extends Person {
  kind: "user";
  key: string;
  self: boolean;
  /** Their own grants' roles, strongest first. */
  roles: Relation[];
  expiry: Expiry;
  /** The teams they also hold the project through. */
  teams: string[];
  action?: RowAction;
}

interface TeamRow {
  kind: "team";
  key: string;
  teamId: string;
  name: string;
  roles: Relation[];
  expiry: Expiry;
  /** The people listed through the team. */
  members: Person[];
  action?: RowAction;
}

export type MemberRow = PersonRow | TeamRow;

/**
 * The table's rows: one per person with grants of their own, then one per
 * team, each team holding the people the members list names it for.
 *
 * The grants say what a row holds and when it ends, since the members list
 * leaves out expired grants and grants weaker than a person's strongest role.
 * The members list says who holds the project through a team and which team
 * owns it, which no grant records. It names a person for a team only where the
 * team gives them their strongest role, so a team's people can be more than
 * it lists.
 *
 * People run the viewer first, then strongest role, then name; teams by name.
 */
export function toMemberRows(
  members: Member[],
  grants: Grant[],
  viewerUserId: string | undefined,
  now: number = Date.now(),
): MemberRow[] {
  const people = new Map<string, { person: Person; grants: Grant[] }>();
  const teams = new Map<
    string,
    { name: string; grants: Grant[]; owning: boolean; members: Person[] }
  >();
  const teamOf = (teamId: string, name?: string) => {
    let team = teams.get(teamId);
    if (!team) {
      team = { name: name ?? teamId, grants: [], owning: false, members: [] };
      teams.set(teamId, team);
    } else if (name && team.name === teamId) {
      team.name = name;
    }
    return team;
  };

  for (const grant of grants) {
    if (grant.team) {
      teamOf(grant.team.team_id, grant.team.name).grants.push(grant);
    } else if (grant.user) {
      const entry = people.get(grant.user.user_id) ?? { person: toPerson(grant.user), grants: [] };
      entry.grants.push(grant);
      people.set(grant.user.user_id, entry);
    }
  }

  const teamsByUser = new Map<string, string[]>();
  for (const member of members) {
    const person = toPerson(member.user);
    for (const source of member.sources) {
      if (!source.team) continue;
      const team = teamOf(source.team.team_id, source.team.name);
      if (source.type === "owning_team") team.owning = true;
      if (!team.members.some((known) => known.userId === person.userId)) {
        team.members.push(person);
        teamsByUser.set(person.userId, [
          ...(teamsByUser.get(person.userId) ?? []),
          source.team.team_id,
        ]);
      }
    }
  }

  const personRows: PersonRow[] = [...people.values()].map(({ person, grants: own }) => {
    const { roles, action } = holding(own, now);
    const self = person.userId === viewerUserId;
    return {
      ...person,
      kind: "user",
      key: `user:${person.userId}`,
      self,
      roles,
      expiry: expiryOf(own, now),
      teams: (teamsByUser.get(person.userId) ?? []).map(
        (teamId) => teams.get(teamId)?.name ?? teamId,
      ),
      // Leaving a project is the viewer's own action, which has no endpoint
      // yet (#2863), so their row offers nothing.
      action: self ? undefined : action,
    };
  });

  const teamRows: TeamRow[] = [...teams.entries()].map(([teamId, team]) => {
    const { roles, action } = holding(team.grants, now);
    return {
      kind: "team",
      key: `team:${teamId}`,
      teamId,
      name: team.name,
      roles: team.owning ? sortRoles(["admin", ...roles]) : roles,
      // Owning the project ends only when the team leaves it, never by date.
      expiry: team.owning ? { kind: "never" } : expiryOf(team.grants, now),
      members: [...team.members].sort((a, b) => byName(a.name, b.name)),
      // The owning team holds the project without a grant, so nothing here
      // takes that away.
      action: team.owning ? undefined : action,
    };
  });

  personRows.sort(
    (a, b) =>
      Number(b.self) - Number(a.self) ||
      STRENGTH[b.roles[0] ?? "viewer"] - STRENGTH[a.roles[0] ?? "viewer"] ||
      byName(a.name, b.name),
  );
  teamRows.sort((a, b) => byName(a.name, b.name));
  return [...personRows, ...teamRows];
}

/**
 * A user ref names a person by `display`, falling back to `identifier`, then
 * `user_id` (ADR 058 §3); the identifier goes beneath a display name.
 */
function toPerson(user: { user_id: string; display?: string; identifier?: string }): Person {
  return {
    userId: user.user_id,
    name: user.display ?? user.identifier ?? user.user_id,
    secondary: user.display ? user.identifier : undefined,
  };
}

/**
 * What a row holds and what its menu offers. The roles are its live grants';
 * with none live, the ones that expired. One role: removing access revokes
 * every grant, expired ones included. More than one: removing a role revokes
 * the weakest, which the strongest already includes.
 */
function holding(grants: Grant[], now: number): { roles: Relation[]; action?: RowAction } {
  if (grants.length === 0) return { roles: [] };
  const live = grants.filter((grant) => isLive(grant, now));
  const roles = sortRoles((live.length > 0 ? live : grants).map((grant) => grant.relation));
  const [strongest] = roles;
  const weakest = roles.at(-1);
  if (roles.length > 1 && strongest && weakest) {
    return {
      roles,
      action: {
        kind: "remove-role",
        grantIds: live.filter((grant) => grant.relation === weakest).map((grant) => grant.id),
        role: weakest,
        keeps: strongest,
      },
    };
  }
  return { roles, action: { kind: "remove-access", grantIds: grants.map((grant) => grant.id) } };
}

function isLive(grant: Grant, now: number): boolean {
  return !grant.expires_at || Date.parse(grant.expires_at) > now;
}

/** Each role once, strongest first. */
function sortRoles(relations: Relation[]): Relation[] {
  return [...new Set(relations)].sort((a, b) => STRENGTH[b] - STRENGTH[a]);
}

/**
 * The row's access ends when its last live grant does: never if one has no
 * end, else on the latest end. With no live grant left it has expired.
 */
function expiryOf(grants: Grant[], now: number): Expiry {
  const live = grants.filter((grant) => isLive(grant, now));
  if (live.length === 0) return grants.length === 0 ? { kind: "never" } : { kind: "expired" };
  const ends = live.map((grant) => grant.expires_at);
  if (ends.some((end) => !end)) return { kind: "never" };
  const latest = ends.reduce((a, b) => (Date.parse(b as string) > Date.parse(a as string) ? b : a));
  return { kind: "on", at: latest as string };
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** `Theo Müller` → `TM`; one word gives its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}
