import { describe, expect, it } from "vitest";

import { PublishCredentials } from "@/cli/commands/auth-method/sso/enable/steps/publish-credentials";
import { createZitadelClient } from "@/lib/backend";
import { CredentialDelivery } from "@/lib/idp";
import { Connection } from "@/lib/zitadel";
import { anAcmeSsoConnection } from "@tests/helpers/connections";
import { clientId, clientSecret } from "@tests/helpers/idp-values";
import { aSuggest } from "@tests/helpers/suggestions";

describe("PublishCredentials", () => {
  it("stops the run when it was interrupted while publishing, so no file is written", async () => {
    const interrupted = new AbortController();
    interrupted.abort(new Error("interrupted"));

    const published = new PublishCredentials({ signal: interrupted.signal, source: "mock" }).run({
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
      delivery: new CredentialDelivery({
        connection: Connection.of({
          path: ".zitadel/idps/acme-sso.json",
          body: anAcmeSsoConnection(),
        }),
        reused: false,
        suggest: aSuggest(),
      }),
      given: { endpoints: undefined, clientId: clientId("abc"), secret: clientSecret("shh") },
    });

    await expect(published).rejects.toThrow("interrupted");
  });
});
