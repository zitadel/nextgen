import type { Directory } from "./ports";
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

/**
 * Zitadel as the person reads it with their session cookie (root ADR 084 §4):
 * who they are, and the teams they are an active member of. The server has
 * no usage or plan API yet (§8.3), so those refuse.
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

    async applyEntitlements() {
      throw new NotLiveError();
    },
  };
}
