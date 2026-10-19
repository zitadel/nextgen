import { describe, expect, it } from "vitest";

import { GOOGLE_PROBES } from "../../../../../src/lib/checks/idp/google";

const refusalUrl = (cause: string) =>
  `https://accounts.google.com/signin/oauth/error?authError=${Buffer.from(`\n\x10${cause}`).toString("base64url")}`;

const at = (url: string, body = "") => ({ status: 200, url, body });

describe("GOOGLE_PROBES.authorize", () => {
  it("rejects a callback URI Google has not registered", () => {
    const verdict = GOOGLE_PROBES.authorize(at(refusalUrl("redirect_uri_mismatch")));

    expect(verdict).toMatchObject({ kind: "rejected", problem: "redirect_uri" });
  });

  it("rejects a client ID Google does not know", () => {
    const verdict = GOOGLE_PROBES.authorize(at(refusalUrl("invalid_client")));

    expect(verdict).toMatchObject({ kind: "rejected", problem: "client" });
  });

  it("accepts a request that ends on a sign-in page", () => {
    const verdict = GOOGLE_PROBES.authorize(
      at("https://accounts.google.com/v3/signin/identifier?x=1"),
    );

    expect(verdict).toEqual({ kind: "accepted" });
  });

  it.each([
    ["an error page naming a cause it does not know", refusalUrl("access_blocked")],
    ["a page that is not a sign-in page", "https://accounts.google.com/somewhere/else"],
  ])("does not recognise %s", (_name, url) => {
    expect(GOOGLE_PROBES.authorize(at(url))).toEqual({ kind: "unknown" });
  });
});

describe("GOOGLE_PROBES.token", () => {
  const answer = (body: object | string) =>
    at(
      "https://oauth2.googleapis.com/token",
      typeof body === "string" ? body : JSON.stringify(body),
    );

  it("accepts the credentials when only the code is refused", () => {
    expect(GOOGLE_PROBES.token(answer({ error: "invalid_grant" }))).toEqual({ kind: "accepted" });
  });

  it("rejects a secret Google does not accept", () => {
    const verdict = GOOGLE_PROBES.token(
      answer({
        error: "invalid_client",
        error_description: "The provided client secret is invalid.",
      }),
    );

    expect(verdict).toMatchObject({ kind: "rejected", problem: "secret" });
  });

  it("rejects a client Google cannot find, as a client problem and not a secret one", () => {
    const verdict = GOOGLE_PROBES.token(
      answer({ error: "invalid_client", error_description: "The OAuth client was not found." }),
    );

    expect(verdict).toMatchObject({ kind: "rejected", problem: "client" });
  });

  it.each([
    ["an error it does not know", { error: "invalid_request" }],
    ["a body that is not JSON", "<html>"],
  ])("does not recognise %s", (_name, body) => {
    expect(GOOGLE_PROBES.token(answer(body))).toEqual({ kind: "unknown" });
  });
});
