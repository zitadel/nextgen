import { beforeEach, describe, expect, it } from "vitest";

import { PublishCredentials } from "@/cli/commands/auth-method/sso/enable/steps/publish-credentials";
import { createZitadelClient } from "@/lib/backend";
import { takeReportedWarnings } from "@/lib/warnings";
import { Connection } from "@/lib/zitadel";
import { aGoogleConnection } from "@tests/helpers/config";
import { anAcmeSsoConnection } from "@tests/helpers/connections";
import { clientId, clientSecret, idVariable, secretVariable } from "@tests/helpers/idp-values";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * What the step reads from the steps before it.
 */
type Needs = Parameters<PublishCredentials["run"]>[0];

/**
 * The connection the credentials belong to, reading both from variables.
 */
const ACME = Connection.of({
  path: ".zitadel/idps/acme-sso.json",
  body: anAcmeSsoConnection(),
});

/**
 * A connection holding its client id as a value and referencing its secret.
 */
const GOOGLE = Connection.of({
  path: ".zitadel/idps/google.json",
  body: aGoogleConnection(),
});

/**
 * Both credentials, as a run was given them.
 */
const GIVEN = { endpoints: undefined, clientId: clientId("abc"), secret: clientSecret("shh") };

/**
 * Nothing, as a reused connection's run was given.
 */
const NOTHING_GIVEN = { endpoints: undefined, clientId: undefined, secret: undefined };

/**
 * What the step reads for a connection.
 *
 * @param input - The connection, the credentials, and whether it was reused.
 * @param input.connection - The connection the credentials belong to.
 * @param input.given - The credentials the run was given.
 * @param input.reused - Whether the connection was already in the project.
 * @param input.signal - The run's Ctrl-C.
 * @returns What the step reads.
 */
function needsFor(input: {
  connection: Connection;
  given: Needs["given"];
  reused?: boolean;
  signal: AbortSignal;
}): Needs {
  const names =
    input.connection === ACME
      ? { clientId: idVariable("acme-sso"), clientSecret: secretVariable("acme-sso") }
      : { clientId: undefined, clientSecret: secretVariable("google") };
  return {
    remote: {
      client: createZitadelClient({
        userAgent: "test",
        baseUrl: "http://localhost:1",
        token: "token",
        signal: input.signal,
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
    names,
    given: input.given,
    summary: {
      projectId: "proj_1",
      provider: "custom",
      displayName: "Acme SSO",
      schema: "customers",
      connection: input.connection,
      reused: input.reused ?? false,
      callbackUri: "http://localhost:3000/callback",
      deployedCallbackUris: [],
      previewCallbackUris: [],
    },
  };
}

beforeEach(() => {
  takeReportedWarnings();
});

describe("PublishCredentials", () => {
  it("stops the run when it was interrupted while publishing, so no file is written", async () => {
    const interrupted = new AbortController();
    interrupted.abort(new Error("interrupted"));

    const published = new PublishCredentials({
      signal: interrupted.signal,
      source: "mock",
      suggest: aSuggest(),
    }).run(needsFor({ connection: ACME, given: GIVEN, signal: interrupted.signal }));

    await expect(published).rejects.toThrow("interrupted");
  });

  it("defers both when there is no project to publish to, and warns how to retry", async () => {
    const run = new AbortController();

    const { published } = await new PublishCredentials({
      signal: run.signal,
      source: "mock",
      suggest: aSuggest(),
    }).run(needsFor({ connection: ACME, given: GIVEN, signal: run.signal }));

    expect(published).toEqual({
      clientId: "deferred",
      secret: { name: secretVariable("acme-sso"), published: "deferred" },
    });
    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining("ACME_SSO_CLIENT_ID was not published to the project"),
      expect.stringContaining("ACME_SSO_CLIENT_SECRET was not published to the project"),
    ]);
  });

  it("suggests a runnable command, and marks the secret as one", async () => {
    const run = new AbortController();

    await new PublishCredentials({
      signal: run.signal,
      source: "mock",
      suggest: aSuggest({}, "1.0.0-alpha.23"),
    }).run(needsFor({ connection: ACME, given: GIVEN, signal: run.signal }));

    const [idWarning, secretWarning] = takeReportedWarnings();
    expect(idWarning).toMatch(/Publish it with: npx .+ variable set ACME_SSO_CLIENT_ID$/);
    expect(idWarning).not.toContain("--secret");
    expect(secretWarning).toContain("variable set ACME_SSO_CLIENT_SECRET --secret");
  });

  it("carries the environment selector so the retry targets the same project", async () => {
    const run = new AbortController();

    await new PublishCredentials({
      signal: run.signal,
      source: "mock",
      suggest: aSuggest({ env: "production" }, "1.0.0-alpha.23"),
    }).run(needsFor({ connection: ACME, given: GIVEN, signal: run.signal }));

    expect(takeReportedWarnings()[0]).toContain("variable set ACME_SSO_CLIENT_ID --env production");
  });

  it("reports a refused publish as failed, and warns how to retry", async () => {
    const interrupted = new AbortController();
    interrupted.abort(new Error("interrupted"));

    await new PublishCredentials({
      signal: interrupted.signal,
      source: "development",
      suggest: aSuggest(),
    })
      .run(needsFor({ connection: ACME, given: GIVEN, signal: interrupted.signal }))
      .catch(() => {});

    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining("ACME_SSO_CLIENT_ID could not be published"),
      expect.stringContaining("ACME_SSO_CLIENT_SECRET could not be published"),
    ]);
  });

  it("sends nothing for a credential that was not given", async () => {
    const run = new AbortController();

    const { published } = await new PublishCredentials({
      signal: run.signal,
      source: "mock",
      suggest: aSuggest(),
    }).run(needsFor({ connection: ACME, given: NOTHING_GIVEN, reused: true, signal: run.signal }));

    expect(published).toEqual({ clientId: undefined, secret: undefined });
    expect(takeReportedWarnings()).toEqual([]);
  });

  it("says a client id held as a value was not published, and does not send it", async () => {
    const run = new AbortController();

    const { published } = await new PublishCredentials({
      signal: run.signal,
      source: "mock",
      suggest: aSuggest(),
    }).run(needsFor({ connection: GOOGLE, given: GIVEN, signal: run.signal }));

    expect(published.clientId).toBeUndefined();
    expect(published.secret).toEqual({ name: secretVariable("google"), published: "deferred" });
    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining(".zitadel/idps/google.json holds its client id directly"),
      expect.stringContaining("GOOGLE_CLIENT_SECRET was not published to the project"),
    ]);
  });

  it("says a reused connection's deferred secret has no value yet", async () => {
    const run = new AbortController();

    await new PublishCredentials({
      signal: run.signal,
      source: "mock",
      suggest: aSuggest(),
    }).run(
      needsFor({
        connection: ACME,
        given: { endpoints: undefined, clientId: undefined, secret: clientSecret("shh") },
        reused: true,
        signal: run.signal,
      }),
    );

    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining("ACME_SSO_CLIENT_SECRET has no value yet"),
    ]);
  });
});
