import { describe, expect, it } from "vitest";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig } from "@tests/helpers/config";
import {
  CONNECTION_FILE,
  CONNECTION_PATH,
  COPY_FILE,
  ACME,
  ACME_COPY,
} from "@tests/helpers/sso-rules";

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
