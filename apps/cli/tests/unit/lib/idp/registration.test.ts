import { describe, expect, it } from "vitest";

import { idpProvider, providerOf } from "@zitadel/config/idp";

import { registrationLines } from "../../../../src/lib/idp";
import { acmeSelection } from "../../../helpers/idp-values";

const CALLBACK = "http://localhost:3000/__nextgen/idp/x/callback";

describe("registrationLines", () => {
  it("sends a catalog provider's developer to its console, with the redirect URI on its own line", () => {
    expect(registrationLines(idpProvider("google"), CALLBACK)).toEqual([
      '"Google" needs an OAuth application. Create one at',
      "https://console.cloud.google.com/apis/credentials",
      "and add this authorized redirect URI to it:",
      CALLBACK,
    ]);
  });

  it("names the issuer for a custom connection, which has no console", () => {
    expect(registrationLines(providerOf(acmeSelection), CALLBACK)).toEqual([
      '"Acme SSO" needs an OAuth application at https://sso.acme.example.',
      "Add this redirect URI to it:",
      CALLBACK,
    ]);
  });

  it("points at the stand-in, not the vendor, when a development run overrides the issuer", () => {
    expect(registrationLines(idpProvider("google"), CALLBACK, "http://localhost:9100")).toEqual([
      '"Google" needs an OAuth application at http://localhost:9100.',
      "Add this redirect URI to it:",
      CALLBACK,
    ]);
  });
});
