import { describe, expect, it } from "vitest";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";
import {
  SCHEMA_FILE,
  FLOW_FILE,
  CONNECTION_FILE,
  CONNECTION_PATH,
  agreeing,
  issuesOf,
} from "@tests/helpers/sso-rules";

describe("sso/unmapped-verification-key", () => {
  describe("when a connection verifies a key it does not map", () => {
    /**
     * A connection verifying `email` while mapping nothing.
     */
    const UNMAPPED = anOidcConnection({ verified_claims: { email: "email_verified" } });

    it("refuses it when a schema lists the connection", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
        connections: { [CONNECTION_FILE]: UNMAPPED },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ rule: "sso/unmapped-verification-key", file: CONNECTION_PATH }),
      );
    });

    it("refuses it when a flow offers the connection", () => {
      const config = aConfig({
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], "not-kept-here") },
        connections: { [CONNECTION_FILE]: UNMAPPED },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ rule: "sso/unmapped-verification-key", file: CONNECTION_PATH }),
      );
    });

    it("leaves it alone when nothing lists or offers the connection", () => {
      const config = aConfig({ connections: { [CONNECTION_FILE]: UNMAPPED } });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      }).filter((issue) => {
        return issue.rule === "sso/unmapped-verification-key";
      });

      expect(issues).toEqual([]);
    });
  });

  it("leaves a verified key unmapped only by a typo to the typo's own finding", () => {
    const documents = agreeing(
      anOidcConnection({
        claim_mapping: { emial: "email" },
        verified_claims: { email: "email_verified" },
        oidc: { scopes: ["openid", "email"] },
      }),
    );

    const issues = issuesOf("sso/unmapped-verification-key", documents);

    expect(issues).toEqual([]);
  });

  it("still reports a verified key no mapping is a typo of", () => {
    const documents = agreeing(
      anOidcConnection({
        claim_mapping: { nickname: "name" },
        verified_claims: { email: "email_verified" },
        oidc: { scopes: ["openid", "email"] },
      }),
    );

    const issues = issuesOf("sso/unmapped-verification-key", documents);

    expect(issues).toMatchObject([{ file: CONNECTION_PATH }]);
  });
});
