import { type ProviderSelection, providerOf } from "@zitadel/config/idp";
import { describe, expect, it } from "vitest";

import { PlanChange } from "@/cli/commands/auth-method/sso/enable/steps/plan-change";
import { createZitadelClient, Origins } from "@/lib/backend";
import type { JsonObject } from "@/lib/zitadel";
import { aConfig, anOidcConnection } from "@tests/helpers/config";
import { CUSTOMERS_PROJECT, CUSTOMERS_SCHEMA } from "@tests/helpers/connections";
import {
  acmeSelection,
  googleSelection,
  idVariable,
  secretVariable,
} from "@tests/helpers/idp-values";

/**
 * What the step reads from what is known.
 */
type Needs = Parameters<PlanChange["run"]>[0];

/**
 * What the step reads when the project already holds the connection.
 *
 * @param connection - The connection document the project holds.
 * @param selection - The provider the run adds, whose connection it is.
 * @returns What the step reads.
 */
function needsHolding(connection: JsonObject, selection: ProviderSelection = acmeSelection): Needs {
  const interrupted = new AbortController();
  return {
    target: {
      cwd: "/tmp/app",
      config: aConfig({
        ...CUSTOMERS_PROJECT,
        connections: { [`${providerOf(selection).slug}.json`]: connection },
      }),
      schema: CUSTOMERS_SCHEMA,
    } as Needs["target"],
    remote: {
      client: createZitadelClient({
        userAgent: "test",
        baseUrl: "http://localhost:1",
        token: "token",
        signal: interrupted.signal,
      }),
      projectId: "proj_1",
      server: "http://localhost:1",
      environment: {
        cwd: "/tmp/app",
        name: { value: "development", source: "default" },
        values: {},
        consulted: [],
      },
    },
    origins: Origins.wrap([]),
    issuer: "http://localhost:3000",
    selection,
    provider: providerOf(selection),
    options: {},
    claims: undefined,
  };
}

describe("PlanChange", () => {
  it("reads the variables the connection references", async () => {
    const { names } = await new PlanChange().run(
      needsHolding(
        anOidcConnection({
          oidc: { client_id: "${{ ACME_CLIENT_ID }}" },
        }),
      ),
    );

    expect(names).toEqual({
      clientId: idVariable("acme"),
      clientSecret: secretVariable("acme"),
    });
  });

  it("derives the variables from the slug when the connection has no oidc block", async () => {
    const { names } = await new PlanChange().run(
      needsHolding(
        { slug: "google", template: "google", protocol: "oidc", display_name: "Google" },
        googleSelection,
      ),
    );

    expect(names).toEqual({
      clientId: idVariable("google"),
      clientSecret: secretVariable("google"),
    });
  });

  it("names no variable for a client id the connection holds as a value", async () => {
    const { names } = await new PlanChange().run(needsHolding(anOidcConnection()));

    expect(names).toEqual({
      clientId: undefined,
      clientSecret: secretVariable("acme"),
    });
  });
});
