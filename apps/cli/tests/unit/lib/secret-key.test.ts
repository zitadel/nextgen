import { describe, expect, it } from "vitest";

import { isBareAddress, isSecretFlag, isSecretKey, isSecretValue } from "@/lib/secret-key";

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

describe("isSecretValue", () => {
  it.each([
    ["client_secret", "s3cr3t-canary-7f3a"],
    ["--password", "hunter2hunter2"],
    ["api-key", "abc123def456"],
  ])("takes %s=%s for a secret", (name, value) => {
    expect(isSecretValue(name, value)).toBe(true);
  });

  it.each([
    ["a platform reference", "client_secret", "${{ ACME_SSO_CLIENT_SECRET }}"],
    ["a placeholder", "client_secret", "<client-secret>"],
    ["an address", "client_secret", "https://idp.example.com/secret"],
    ["a number", "password", "12345678"],
    ["a name that holds no secret", "display_name", "hunter2hunter2"],
    ["a setting about credentials", "password_hash", "argon2id"],
    ["a value that is no string", "password", 42],
  ])("does not take %s", (_what, name, value) => {
    expect(isSecretValue(name, value)).toBe(false);
  });

  it("takes an address that carries a credential for a secret", () => {
    expect(isSecretValue("client_secret", "https://user:pass@idp.example.com")).toBe(true);
  });
});

describe("isBareAddress", () => {
  it.each(["https://idp.example.com/token", "http://localhost:8080"])("is true for %s", (value) => {
    expect(isBareAddress(value)).toBe(true);
  });

  it.each([
    "https://user:pass@idp.example.com",
    "https://idp.example.com/?access_token=abc",
    "not a url",
    42,
  ])("is false for %s", (value) => {
    expect(isBareAddress(value)).toBe(false);
  });
});
