import { apiBaseUrl } from "@zitadel/api/runtime/base-url";
import { describe, expect, it } from "vitest";

import { injectZitadel, SESSION_COOKIE_NAME } from "@zitadel/testing/vitest";

// Run via `turbo run test:integration --filter=@zitadel/testing`: the task
// builds the server binary and the CLI, and injects ZITADEL_SERVER_BINARY.
// The instance comes from ./global-setup.ts, one per run.
describe.skipIf(!process.env.ZITADEL_SERVER_BINARY)(
  "@zitadel/testing/vitest (real instance)",
  () => {
    it("authenticates a backend call with a seeded session, no browser", async () => {
      const zitadel = injectZitadel();
      const session = await zitadel.seedSession();

      const me = await getMySession(
        zitadel.handle.baseUrl,
        zitadel.handle.projectId,
        session.sessionToken,
      );
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({
        project_id: zitadel.handle.projectId,
        user_id: session.user.id,
      });

      // The same call without a live session is refused, so the 200 above is
      // the session's doing.
      const anonymous = await getMySession(
        zitadel.handle.baseUrl,
        zitadel.handle.projectId,
        "not-a-session",
      );
      expect(anonymous.ok).toBe(false);
    });

    it("seeds a fresh user per test on the shared instance", async () => {
      const zitadel = injectZitadel();
      const [first, second] = await Promise.all([zitadel.seedUser(), zitadel.seedUser()]);
      expect(first.id).not.toBe(second.id);
      const { users } = await zitadel.api.queryUsers({});
      expect(users.map((user) => user.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    });
  },
);

/** `GET /sessions/me`, authenticated the way the SDK middleware does it: by cookie. */
function getMySession(baseUrl: string, projectId: string, sessionToken: string): Promise<Response> {
  return fetch(`${apiBaseUrl(baseUrl)}/sessions/me?project_id=${encodeURIComponent(projectId)}`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
  });
}
