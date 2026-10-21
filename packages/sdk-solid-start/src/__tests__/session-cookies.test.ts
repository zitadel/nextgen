/**
 * How the SolidStart middleware writes session cookies, beyond the contract
 * every server SDK shares: SolidStart 2's response is h3 v2's, which sends
 * `errHeaders` instead of `headers` when the page answers with status 400 or
 * above, or throws, so the cookies go into both.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSessionCheckCache } from "@zitadel/sdk-core/middleware";

import type { SolidFetchEvent } from "../middleware";

import { createNextgenMiddleware } from "../middleware";

const PROJECT = "proj_app";
const SESSION = `__nextgen_session_${PROJECT}`;

describe("session cookies on h3 v2's error headers", () => {
  beforeEach(() => {
    clearSessionCheckCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes a copied session cookie to the headers of an error answer as well", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ project_id: PROJECT, user_id: "u1" })),
    );
    const event: SolidFetchEvent = {
      request: new Request("http://localhost:3000/missing", {
        headers: { cookie: "__nextgen_session=tok" },
      }),
      locals: {},
      response: { headers: new Headers(), errHeaders: new Headers() },
    };

    const answer = await createNextgenMiddleware({
      url: "http://localhost:4000",
      projectId: PROJECT,
    }).onRequest[0]!(event);

    expect(answer).toBeUndefined();
    for (const headers of [event.response?.headers, event.response?.errHeaders]) {
      expect(headers?.getSetCookie()).toEqual([
        expect.stringMatching(new RegExp(`^${SESSION}=tok;`)),
      ]);
      expect(headers?.get("cache-control")).toBe("private, no-store");
    }
  });
});
