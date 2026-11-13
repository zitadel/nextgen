import { apiBaseUrl } from "@zitadel/api/runtime/base-url";
import { describe, expect, it } from "vitest";

import { injectZitadel, SESSION_COOKIE_NAME } from "@zitadel/testing/vitest";

// Run via `turbo run test:integration --filter=@zitadel/testing`: the task
// builds the server binary and the CLI, and injects ZITADEL_SERVER_BINARY.
// The instance comes from ./global-setup.ts.
describe.skipIf(!process.env.ZITADEL_SERVER_BINARY)(
  "@zitadel/testing/vitest (real instance)",
  () => {
    it("authenticates a backend call with a seeded session, no browser", async () => {
      const zitadel = injectZitadel();
      const session = await zitadel.seedSession();
      const { baseUrl, projectId } = zitadel.handle;

      const me = await getMySession(baseUrl, projectId, session.sessionToken);
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ project_id: projectId, user_id: session.user.id });

      // The same call without a live session is refused, so the 200 above is
      // the session's doing.
      const anonymous = await getMySession(baseUrl, projectId, "not-a-session");
      expect(anonymous.ok).toBe(false);
    });
  },
);

/**
 * `GET /sessions/me` on the instance, authenticated by cookie under the
 * server's canonical name, as a direct call to the server sends it.
 */
function getMySession(baseUrl: string, projectId: string, sessionToken: string): Promise<Response> {
  return fetch(`${apiBaseUrl(baseUrl)}/sessions/me?project_id=${encodeURIComponent(projectId)}`, {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
  });
}
