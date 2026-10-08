import { describe, expect, it } from "vitest";

import {
  bootstrapUserDocument,
  DEFAULT_ADMIN_TEAM_ID,
  DEFAULT_ADMIN_USER_ID,
  DEFAULT_SCHEMA_URL,
  newAdminCredential,
  PBKDF2_ROUNDS,
  pbkdf2Hash,
  PLATFORM_PROJECT_ID,
  verifyPbkdf2,
} from "./admin-user";

describe("newAdminCredential", () => {
  it("mints a long random password and the platform admin ids", () => {
    const a = newAdminCredential("ops@example.com");
    const b = newAdminCredential("ops@example.com");
    expect(a.password).toHaveLength(32);
    expect(a.password).not.toBe(b.password);
    expect(a.user_id).toBe(DEFAULT_ADMIN_USER_ID);
    expect(a.team_id).toBe(DEFAULT_ADMIN_TEAM_ID);
  });

  it("rejects something that is not an email, since the schema signs users in by email", () => {
    expect(() => newAdminCredential("not-an-email")).toThrow(/email/);
  });
});

describe("bootstrapUserDocument", () => {
  it("matches the shape the server's bootstrap import validates", () => {
    const admin = newAdminCredential("ops@example.com", { password: "pw" });
    const doc = bootstrapUserDocument(admin, DEFAULT_SCHEMA_URL, Buffer.alloc(16, 1));
    expect(doc.header).toEqual({
      project_id: PLATFORM_PROJECT_ID,
      team_id: DEFAULT_ADMIN_TEAM_ID,
      schema_url: DEFAULT_SCHEMA_URL,
      id: DEFAULT_ADMIN_USER_ID,
    });
    expect(doc.attributes).toEqual({
      username: "ops@example.com",
      email: "ops@example.com",
      "zitadel.source": "cli",
      "zitadel.default_user": true,
    });
    expect(doc.authenticators.password.change_required).toBe(false);
    expect(doc.authenticators.password.encoded_hash).toMatch(
      new RegExp(`^\\$pbkdf2-sha256\\$${PBKDF2_ROUNDS}\\$[A-Za-z0-9./]+\\$[A-Za-z0-9./]+$`),
    );
    expect(JSON.stringify(doc)).not.toContain('"pw"');
  });
});

describe("pbkdf2Hash", () => {
  it("uses passlib's adapted base64 (no padding, '.' for '+') and round-trips", () => {
    const salt = Buffer.from("fbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfb", "hex"); // base64 of 0xfb… contains '+'
    const encoded = pbkdf2Hash("correct horse", salt);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("=");
    expect(verifyPbkdf2("correct horse", encoded)).toBe(true);
    expect(verifyPbkdf2("wrong horse", encoded)).toBe(false);
  });
});
