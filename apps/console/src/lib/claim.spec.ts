import { CSRF_HEADER } from "@zitadel/api/runtime/fetch";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetSessionForTesting, fetchSession, sessionPage } from "../auth/session";
import { makeTestSession } from "@/test/session.fixture";
import { completeProjectClaim } from "./claim";
import { server } from "@/test/msw";

beforeEach(() => {
  _resetSessionForTesting();
  vi.spyOn(sessionPage, "reload").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("completeProjectClaim", () => {
  // The claim route's loader reads the session, and with it the CSRF token,
  // before the completion step renders. The completion does not read them
  // again: if that token read failed, the refused write recovers through the
  // shared fetch's rejection handler, as any console write does.
  it("recovers when the loader could not read the token", async () => {
    let tokenReads = 0;
    const sent: Array<string | null> = [];
    server.use(
      http.get("*/sessions/me", () => HttpResponse.json(makeTestSession({ user_id: "user_a" }))),
      http.get("*/sessions/me/csrf", () => {
        tokenReads += 1;
        return tokenReads === 1
          ? HttpResponse.json({ code: "internal", message: "no" }, { status: 500 })
          : HttpResponse.json({ csrf_token: "tok" });
      }),
      http.post("*/projects/proj_1/claim/complete", ({ request }) => {
        const token = request.headers.get(CSRF_HEADER);
        sent.push(token);
        return token === "tok"
          ? HttpResponse.json({
              project_id: "proj_1",
              team_id: "team_a",
              claimed_at: "2027-01-01T00:00:00Z",
            })
          : HttpResponse.json({ code: "auth.csrf_invalid", message: "refused" }, { status: 403 });
      }),
    );

    // The loader: signed in, but the token read failed.
    expect(await fetchSession()).toMatchObject({ user_id: "user_a" });

    await expect(completeProjectClaim("proj_1", "ch_1")).resolves.toMatchObject({
      kind: "claimed",
      teamId: "team_a",
    });
    expect(sent).toEqual([null, "tok"]);
    expect(sessionPage.reload).not.toHaveBeenCalled();
  });
});
