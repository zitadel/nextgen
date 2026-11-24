import { describe, expect, it } from "vitest";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import { CONNECTION_FILE, CONNECTION_PATH, ACME } from "@tests/helpers/sso-rules";

/**
 * The file name of a second connection claiming the same slug.
 */
const COPY_FILE = "copy.json";

/**
 * A second connection claiming {@link ACME}'s slug, with a secret of its own.
 */
const ACME_COPY = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"], client_secret: "${{ COPY_CLIENT_SECRET }}" },
});

describe("sso/duplicate-slug", () => {
  it("refuse a second connection file that claims a slug, naming the first", () => {
    const config = aConfig({ connections: { [CONNECTION_FILE]: ACME, [COPY_FILE]: ACME_COPY } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/duplicate-slug",
        file: `.zitadel/idps/${COPY_FILE}`,
        message: `connection slug "acme" is also used by ${CONNECTION_PATH}. A slug names one connection: change the slug here, or delete one of the two files.`,
      },
    ]);
  });
});
