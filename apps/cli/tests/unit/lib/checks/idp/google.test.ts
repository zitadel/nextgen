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
    ["a sign-in page this check does not know", "https://accounts.google.com/signin/v2/other"],
    ["a sign-in page on another host", "https://elsewhere.example/v3/signin/identifier"],
  ])("does not recognise %s", (_name, url) => {
    expect(GOOGLE_PROBES.authorize(at(url))).toEqual({ kind: "unknown" });
  });

  it("does not accept the sign-in page when it was served with an error", () => {
    const failing = {
      status: 500,
      url: "https://accounts.google.com/v3/signin/identifier",
      body: "",
    };

    expect(GOOGLE_PROBES.authorize(failing)).toEqual({ kind: "unknown" });
  });
});
