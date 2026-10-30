import { describe, expect, it } from "vitest";

import { isSecretPath } from "../../../src/lib/secret-paths";

describe("isSecretPath", () => {
  it.each([
    ".env",
    ".env.local",
    ".envrc",
    "apps/web/.env",
    ".zitadel/secret",
    "apps/web/.zitadel/secret",
    ".zitadel/local",
    ".zitadel/local/admin.json",
    "nested/.zitadel/local/data/db",
    ".ENV",
    ".Env.local",
    ".Zitadel/Secret",
    ".ZITADEL/LOCAL/admin.json",
  ])("treats %s as a secret", (path) => {
    expect(isSecretPath(path)).toBe(true);
  });

  it.each([
    ".env.example",
    "apps/web/.env.example",
    ".ENV.EXAMPLE",
    "src/env.ts",
    ".zitadel/schemas/user.json",
    ".zitadel/secrets/readme.md",
    ".zitadel/locales/en.json",
    "docs/local/readme.md",
    ".npmrc",
    "certs/server.pem",
  ])("does not treat %s as a secret", (path) => {
    expect(isSecretPath(path)).toBe(false);
  });
});
