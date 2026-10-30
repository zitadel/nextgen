import { describe, expect, it } from "vitest";

import { newestPrimaryDeployments, servesPrimary } from "../../../../src/lib/release/deployment";

const PRIMARY = [{ origin: "https://app.acme.com", expires_at: null }];
const PREVIEW = [{ origin: "https://pr-1.acme.com", expires_at: "2026-12-01T00:00:00Z" }];

/** A client whose history is `targets`, newest first, counting the deployments read. */
function history(...targets: (typeof PRIMARY | typeof PREVIEW)[]) {
  const read = { count: 0 };
  const client = {
    listDeployments: {
      items: async function* () {
        for (const [index, deploymentTargets] of targets.entries()) {
          read.count += 1;
          yield { id: `dep_${index + 1}`, targets: deploymentTargets };
        }
      },
    },
  } as never;
  return { client, read };
}

describe("newestPrimaryDeployments", () => {
  it("skips previews to find the primary deployments, newest first", async () => {
    const { client } = history(PREVIEW, PRIMARY, PREVIEW, PRIMARY);

    const found = await newestPrimaryDeployments(client, "proj_1", 2);

    expect(found.map((deployment) => deployment.id)).toEqual(["dep_2", "dep_4"]);
  });

  it("reads no further than the deployments it was asked for", async () => {
    const { client, read } = history(PRIMARY, PRIMARY, PRIMARY);

    await newestPrimaryDeployments(client, "proj_1", 2);

    expect(read.count).toBe(2);
  });

  it("returns what there is when the history runs out first", async () => {
    const { client } = history(PRIMARY, PREVIEW);

    expect(await newestPrimaryDeployments(client, "proj_1", 2)).toHaveLength(1);
  });
});

describe("servesPrimary", () => {
  it("is true for a deployment with an unexpiring target", () => {
    expect(servesPrimary({ targets: [{ origin: "https://a", expires_at: null }] } as never)).toBe(
      true,
    );
  });

  it("is false for a preview deployment", () => {
    expect(
      servesPrimary({
        targets: [{ origin: "https://pr-1", expires_at: "2026-12-01T00:00:00Z" }],
      } as never),
    ).toBe(false);
  });
});
