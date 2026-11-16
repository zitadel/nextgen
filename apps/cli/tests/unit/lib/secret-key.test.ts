import { describe, expect, it } from "vitest";

import { isSecretFlag, isSecretKey } from "@/lib/secret-key";

describe("isSecretKey", () => {
  it.each(["password", "api_key", "userToken", "client_secret", "PRIVATE_KEY", "access-token"])(
    "reads %s as a credential's name",
    (key) => {
      expect(isSecretKey(key)).toBe(true);
    },
  );

  it.each(["passwordless", "tokenizer", "email", "display_name", "revocationEndpoint"])(
    "does not read %s as one",
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );

  it.each(["token_endpoint", "token_url", "secret_uri"])(
    "reads %s as one too: only a value that is an address lets it through",
    (key) => {
      expect(isSecretKey(key)).toBe(true);
    },
  );
});

describe("isSecretFlag", () => {
  it.each(["password", "client-secret", "oidc-client-secret", "apiKey", "access-token"])(
    "reads --%s as holding a secret",
    (name) => {
      expect(isSecretFlag(name)).toBe(true);
    },
  );

  it.each([
    "client-secret-file",
    "oidc-token-endpoint",
    "oidc-token-endpoint-auth-method",
    "password-min-length",
    "password-hash-algorithm",
    "password-hash-params-time",
    "password-policy",
    "secret-var",
    "page-token",
    "pageToken",
    "display-name",
  ])("does not read --%s as holding one", (name) => {
    expect(isSecretFlag(name)).toBe(false);
  });
});
