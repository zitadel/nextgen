import { beforeEach, describe, expect, it } from "vitest";

import { PublishCredentials } from "@/cli/commands/setup/steps/publish-credentials";
import { takeReportedWarnings } from "@/lib/warnings";
import { acmeSelection, clientId, clientSecret, secretVariable } from "@tests/helpers/idp-values";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * What the step reads from what is known.
 */
type Needs = Parameters<PublishCredentials["run"]>[0];

/**
 * What the step is given by the command.
 */
type Deps = ConstructorParameters<typeof PublishCredentials>[0];

/**
 * What the step reads for a run that answered with one provider and addresses
 * the mock server, which has no variables to publish to.
 */
const NEEDS = {
  answers: {
    server: "mock",
    sso: [
      {
        selection: acmeSelection,
        credentials: { clientId: clientId("abc"), secret: clientSecret("shh") },
      },
    ],
  },
  project: { id: "proj_1", project_secret: "secret" },
} as unknown as Needs;

/**
 * What the step is given by the command.
 *
 * @param overrides - What differs from a run that publishes.
 * @returns What the command gives the step.
 */
function depsFor(overrides: Partial<Deps> = {}): Deps {
  return {
    dryRun: false,
    signal: new AbortController().signal,
    suggest: aSuggest({}, "1.0.0-alpha.23"),
    ...overrides,
  };
}

beforeEach(() => {
  takeReportedWarnings();
});

describe("PublishCredentials", () => {
  it("defers both credentials when there is no project to publish to", async () => {
    const { ssoOutcomes } = await new PublishCredentials(depsFor()).run(NEEDS);

    expect(ssoOutcomes.get(acmeSelection.connection.slug)).toEqual({
      clientId: "deferred",
      secret: { name: secretVariable("acme"), published: "deferred" },
    });
  });

  it("warns with a runnable command for each, and marks the secret as one", async () => {
    await new PublishCredentials(depsFor()).run(NEEDS);

    const [idWarning, secretWarning] = takeReportedWarnings();
    expect(idWarning).toMatch(
      /ACME_CLIENT_ID was not published to the project\. .*npx .+ variable set ACME_CLIENT_ID$/,
    );
    expect(idWarning).not.toContain("--secret");
    expect(secretWarning).toContain("variable set ACME_CLIENT_SECRET --secret");
  });

  it("carries the environment selector so the retry targets the same project", async () => {
    await new PublishCredentials(
      depsFor({ suggest: aSuggest({ env: "production" }, "1.0.0-alpha.23") }),
    ).run(NEEDS);

    expect(takeReportedWarnings()[0]).toContain("variable set ACME_CLIENT_ID --env production");
  });

  it("publishes nothing on a dry run", async () => {
    const { ssoOutcomes } = await new PublishCredentials(depsFor({ dryRun: true })).run(NEEDS);

    expect(ssoOutcomes.size).toBe(0);
    expect(takeReportedWarnings()).toEqual([]);
  });
});
