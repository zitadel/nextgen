import { describe, expect, it } from "vitest";

import { missingEndpoints } from "./endpoints.js";

const all = {
  authorization_endpoint: "https://idp.test/authorize",
  jwks_uri: "https://idp.test/jwks",
  token_endpoint: "https://idp.test/token",
  userinfo_endpoint: "https://idp.test/userinfo",
};

describe("the server's endpoint rule", () => {
  it("accepts a block that names no endpoint, which reads them from discovery", () => {
    expect(missingEndpoints({ issuer: "https://idp.test" })).toEqual([]);
  });

  it("accepts a block that names every endpoint", () => {
    expect(missingEndpoints(all)).toEqual([]);
  });

  it("does not need userinfo_endpoint under id_token_mapping", () => {
    const { userinfo_endpoint: _left, ...rest } = all;

    expect(missingEndpoints({ ...rest, id_token_mapping: true })).toEqual([]);
  });

  it("lists what a partial block leaves out, in the server's order", () => {
    expect(missingEndpoints({ token_endpoint: all.token_endpoint })).toEqual([
      "authorization_endpoint",
      "jwks_uri",
      "userinfo_endpoint",
    ]);
  });

  it("refuses userinfo_endpoint alone even under id_token_mapping", () => {
    expect(
      missingEndpoints({ userinfo_endpoint: all.userinfo_endpoint, id_token_mapping: true }),
    ).toEqual(["authorization_endpoint", "jwks_uri", "token_endpoint"]);
  });

  it("reads an empty string as unset, as the server does", () => {
    expect(missingEndpoints({ ...all, jwks_uri: "" })).toEqual(["jwks_uri"]);
    expect(missingEndpoints({ authorization_endpoint: "" })).toEqual([]);
  });

  it("reads anything that is not a block as one naming none", () => {
    expect(missingEndpoints(undefined)).toEqual([]);
    expect(missingEndpoints("oidc")).toEqual([]);
  });
});
