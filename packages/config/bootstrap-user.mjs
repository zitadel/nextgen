// SPDX-License-Identifier: MIT
import { pbkdf2Sync, randomBytes } from "node:crypto";

/**
 * Builds a server bootstrap document without retaining its plaintext password.
 * Node-only, shipped directly so cloud setup can use it without a build.
 * @param {import("./bootstrap-user.mjs").BootstrapUserOptions} options
 */
export function bootstrapUserDocument({
  email,
  password,
  user_id,
  team_id,
  project_id,
  schema_url,
}) {
  const rounds = 210_000;
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, rounds, 32, "sha256");
  // passlib's adapted base64: `+` becomes `.` and padding is dropped.
  const ab64 = (bytes) => bytes.toString("base64").replace(/=+$/, "").replaceAll("+", ".");
  return {
    header: { project_id, team_id, schema_url, id: user_id },
    attributes: {
      username: email,
      email,
      "zitadel.source": "cli",
      "zitadel.default_user": true,
    },
    authenticators: {
      password: {
        encoded_hash: `$pbkdf2-sha256$${rounds}$${ab64(salt)}$${ab64(hash)}`,
        change_required: false,
      },
    },
  };
}
