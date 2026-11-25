import { pbkdf2Sync } from "node:crypto";
import { expect, it } from "vitest";

import { bootstrapUserDocument } from "@zitadel/config/bootstrap-user";

it("builds a bootstrap document with a passlib hash the server can verify", () => {
  const input = {
    email: "admin@example.test",
    password: "test-only-password",
    user_id: "user_admin",
    team_id: "team_admin",
    project_id: "proj_custom",
    schema_url: "https://example.test/schemas/user.json",
  };
  const doc = bootstrapUserDocument(input);
  expect(doc.header).toEqual({
    id: input.user_id,
    team_id: input.team_id,
    project_id: input.project_id,
    schema_url: input.schema_url,
  });
  expect(doc.attributes).toEqual({
    username: input.email,
    email: input.email,
    "zitadel.source": "cli",
    "zitadel.default_user": true,
  });
  expect(JSON.stringify(doc)).not.toContain(input.password);
  const [, algorithm, rounds, salt, hash] = doc.authenticators.password.encoded_hash.split("$");
  expect(algorithm).toBe("pbkdf2-sha256");
  const decode = (value: string) => Buffer.from(value.replaceAll(".", "+"), "base64");
  expect(
    pbkdf2Sync(input.password, decode(salt!), Number(rounds), 32, "sha256").equals(decode(hash!)),
  ).toBe(true);
  expect(doc.authenticators.password.change_required).toBe(false);
  expect(bootstrapUserDocument(input).authenticators.password.encoded_hash).not.toBe(
    doc.authenticators.password.encoded_hash,
  );
});
