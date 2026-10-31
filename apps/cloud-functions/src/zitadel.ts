import type { Directory, TeamDays } from "./ports";
import { NotLiveError } from "./systems";

/**
 * Where the functions reach the Zitadel server. Deployed, it answers on the
 * request's own origin. Behind a dev proxy (the console's dev server, or
 * `vercel dev` in `workspace:cloud`) that origin is the functions' own, so
 * both local loops name the server in `CLOUD_ZITADEL_URL` (moon.yml,
 * scripts/run-cloud.mjs).
 */
export function zitadelServer(request: Request): string {
  return process.env.CLOUD_ZITADEL_URL || new URL(request.url).origin;
}

/**
 * Lets a call from the functions through to the server on a preview, whose
 * own origin sits behind Vercel Authentication as it does for a browser.
 */
export function passProtection(headers: Headers): Headers {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);
  return headers;
}

/** `GET /users/me`, as far as the functions read it. */
interface MyUser {
  id: string;
  attributes?: Record<string, unknown>;
  identifier?: string;
  display?: string;
}

/** One page of `GET /users/me/teams`. */
interface MyTeams {
  teams: { id: string; name: string; membership_status: string; created_at: string }[];
  next_page_token?: string | null;
}

/** One page of `GET /users/me/projects`. */
interface MyProjects {
  projects: { id: string; name: string }[];
  next_page_token?: string | null;
}

/** `GET /usage`, as far as the functions read it (root ADR 085). */
interface ProjectUsage {
  data: { meter: string; start: string; value: number }[];
  team_id: string | null;
}

/**
 * Zitadel as the person reads it with their session cookie (root ADR 084 §4):
 * who they are, the teams they are an active member of, and their projects'
 * usage. The server has no operator usage feed or plan API yet (§8.3), so
 * those refuse.
 */
export function liveDirectory(server: string): Directory {
  async function read<T>(cookie: string, path: string): Promise<T | undefined> {
    const url = new URL(path, server);
    const answer = await fetch(url, {
      headers: passProtection(new Headers({ accept: "application/json", cookie })),
    });
    // No session, or an anonymous one: no one is calling.
    if (answer.status === 401) return undefined;
    if (!answer.ok) throw new Error(`Zitadel answered GET ${url.pathname} with ${answer.status}.`);
    return (await answer.json()) as T;
  }

  return {
    async caller(cookie) {
      const user = await read<MyUser>(cookie, "/users/me");
      if (!user) return undefined;
      const email = user.attributes?.email;
      return {
        user_id: user.id,
        email: typeof email === "string" ? email : (user.identifier ?? ""),
        ...(user.display ? { display: user.display } : {}),
      };
    },

    async administeredTeams(cookie) {
      const memberships: MyTeams["teams"] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({
          limit: "100",
          ...(pageToken ? { page_token: pageToken } : {}),
        });
        const page = await read<MyTeams>(cookie, `/users/me/teams?${query}`);
        if (!page) return [];
        memberships.push(...page.teams);
        pageToken = page.next_page_token ?? undefined;
      } while (pageToken);
      // The server models no personal team: it is the person's earliest
      // membership, whatever its status, and only while that one is active. It
      // never falls back to a later team (`GetPersonalTeamForUser` in
      // internal/service/statement.go). The API leaves out memberships the
      // person was removed from.
      const earliest = memberships.reduce<(typeof memberships)[number] | undefined>(
        (first, membership) =>
          !first || Date.parse(membership.created_at) < Date.parse(first.created_at)
            ? membership
            : first,
        undefined,
      );
      return memberships
        .filter((membership) => membership.membership_status === "active")
        .map(({ id, name }) => ({ id, name, personal: id === earliest?.id }));
    },

    async usage() {
      throw new NotLiveError();
    },

    async usageByDay(cookie, team, days) {
      const projects: MyProjects["projects"] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({
          limit: "100",
          ...(pageToken ? { page_token: pageToken } : {}),
        });
        const page = await read<MyProjects>(cookie, `/users/me/projects?${query}`);
        if (!page) return { projects: [], counts: [] };
        projects.push(...page.projects);
        pageToken = page.next_page_token ?? undefined;
      } while (pageToken);

      // The usage of each project names the team that claimed it, which no
      // other read tells the functions.
      const reads = await Promise.all(
        projects.map(async (project) => {
          const query = new URLSearchParams({
            project_id: project.id,
            from: days.start,
            to: days.end,
            granularity: "day",
          });
          // A project the person lists but cannot read the usage of, or a
          // server that counts none, adds nothing.
          const usage = await read<ProjectUsage>(cookie, `/usage?${query}`).catch(() => undefined);
          return { project, usage };
        }),
      );
      const owned: TeamDays = { projects: [], counts: [] };
      for (const { project, usage } of reads) {
        if (!usage || usage.team_id !== team.id) continue;
        owned.projects.push({ id: project.id, name: project.name });
        for (const bucket of usage.data) {
          owned.counts.push({
            // As the pricing keys days: the server writes RFC 3339 without milliseconds.
            day: new Date(bucket.start).toISOString(),
            project_id: project.id,
            metric: bucket.meter,
            value: bucket.value,
          });
        }
      }
      return owned;
    },

    async applyEntitlements() {
      throw new NotLiveError();
    },
  };
}
