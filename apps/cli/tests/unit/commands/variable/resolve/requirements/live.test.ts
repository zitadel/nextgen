import { describe, expect, it } from "vitest";

import { liveDeployment } from "../../../../../../src/commands/variable/resolve/requirements/live";
import { requirementContext } from "../../../../../helpers/requirement-context";

type Deployment = { id: string; targets: { origin: string }[] };

function connectedTo(options: {
  deployments: Deployment[];
  origins?: { kind: string; pattern: string }[];
  origin?: string;
}) {
  return {
    ...requirementContext({
      flags: options.origin === undefined ? {} : { origin: options.origin },
    }),
    connect: async () => {
      return {
        client: {
          listDeployments: {
            all: async () => {
              return options.deployments;
            },
          },
          getProject: async () => {
            return { origins: options.origins ?? [] };
          },
        },
        projectId: "proj_1",
      } as never;
    },
  };
}

describe("liveDeployment", () => {
  it("is the one deployment that is live", async () => {
    const live = { id: "dep_1", targets: [{ origin: "https://app.acme.com" }] };

    expect(await liveDeployment.resolve(connectedTo({ deployments: [live] }))).toBe(live);
  });

  it("names the live origins when several deployments are live and none is chosen", async () => {
    await expect(
      liveDeployment.resolve(
        connectedTo({
          deployments: [
            { id: "a", targets: [{ origin: "https://b.acme.com" }] },
            { id: "b", targets: [{ origin: "https://a.acme.com" }] },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      hint: "Live origins: https://a.acme.com, https://b.acme.com.",
    });
  });

  it("says nothing is deployed to the project", async () => {
    await expect(liveDeployment.resolve(connectedTo({ deployments: [] }))).rejects.toMatchObject({
      code: "E_NOT_FOUND",
      message: "Nothing is deployed to the project.",
    });
  });

  it("says how to reach a primary origin nothing is deployed to", async () => {
    await expect(
      liveDeployment.resolve(
        connectedTo({
          deployments: [],
          origin: "https://app.acme.com",
          origins: [{ kind: "primary", pattern: "https://app.acme.com" }],
        }),
      ),
    ).rejects.toMatchObject({ message: "Nothing is deployed to https://app.acme.com." });
  });

  it("explains that a preview origin is served by a pull-request build", async () => {
    await expect(
      liveDeployment.resolve(
        connectedTo({
          deployments: [],
          origin: "https://pr-1.acme.com",
          origins: [{ kind: "preview", pattern: "https://pr-*.acme.com" }],
        }),
      ),
    ).rejects.toMatchObject({ hint: expect.stringContaining("pull-request build") });
  });

  it("refuses an origin the project does not have", async () => {
    await expect(
      liveDeployment.resolve(connectedTo({ deployments: [], origin: "https://typo.acme.com" })),
    ).rejects.toMatchObject({ message: "https://typo.acme.com is not an origin of the project." });
  });
});
