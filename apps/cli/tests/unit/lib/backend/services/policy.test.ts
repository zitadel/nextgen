import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { PolicyService } from "@/lib/backend/services/policy";
import { answering, answeringPages } from "@tests/helpers/api-answers";

/** The only operation the spec's policies guard. */
const OPERATION = "auth.factor.password.set";

describe("PolicyService.list", () => {
  it("lists every policy of the project it is bound to, narrowed by the query", async ({
    server,
    client,
  }) => {
    const listed = answeringPages(server, "listPolicies", { policies: [{ id: "pol_1" }] });

    const policies = await new PolicyService(client, "proj_1").list({ operation: OPERATION });

    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([{ project_id: "proj_1", operation: OPERATION }]);
    expect(policies).toEqual([{ id: "pol_1" }]);
  });

  it("drains past the first page, so a caller sees every policy", async ({ server, client }) => {
    answeringPages(
      server,
      "listPolicies",
      { policies: [{ id: "pol_2" }] },
      { policies: [{ id: "pol_1" }] },
    );

    const policies = await new PolicyService(client, "proj_1").list();

    expect(policies).toEqual([{ id: "pol_2" }, { id: "pol_1" }]);
  });
});

describe("PolicyService.page", () => {
  it("reads one page and the cursor to the next", async ({ server, client }) => {
    answering(server, "listPolicies", { policies: [{ id: "pol_2" }], next_page_token: "t2" });

    const first = await new PolicyService(client, "proj_1").page();

    expect(first.items).toEqual([{ id: "pol_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async ({ server, client }) => {
    answeringPages(server, "listPolicies", { policies: [] });

    const first = await new PolicyService(client, "proj_1").page();

    expect(first.next).toBeNull();
  });
});

describe("PolicyService.get", () => {
  it("reads the policy for the project it is bound to", async ({ server, client }) => {
    const read = answering(server, "getPolicy", { id: "pol_1" });

    await new PolicyService(client, "proj_1").get("pol_1");

    expect(
      read.map(({ params, url }) => {
        return [params.policy_id, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([["pol_1", { project_id: "proj_1" }]]);
  });
});

describe("PolicyService.ofOperation", () => {
  it("answers the policy of one operation", async ({ server, client }) => {
    const listed = answeringPages(server, "listPolicies", { policies: [{ id: "pol_1" }] });

    await expect(new PolicyService(client, "proj_1").ofOperation(OPERATION)).resolves.toEqual({
      id: "pol_1",
    });
    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([{ project_id: "proj_1", operation: OPERATION, limit: "1" }]);
  });

  it("answers nothing when the project has no policy for it", async ({ server, client }) => {
    answeringPages(server, "listPolicies", { policies: [] });

    await expect(
      new PolicyService(client, "proj_1").ofOperation(OPERATION),
    ).resolves.toBeUndefined();
  });
});

describe("PolicyService.revision", () => {
  it("reads one pinned revision for the project it is bound to", async ({ server, client }) => {
    const read = answering(server, "getPolicyRevision", { revision_id: "polrev_1" });

    await new PolicyService(client, "proj_1").revision("polrev_1");

    expect(
      read.map(({ params, url }) => {
        return [params.revision_id, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([["polrev_1", { project_id: "proj_1" }]]);
  });
});

describe("PolicyService.publish", () => {
  it("sends the operation and its config as given", async ({ server, client }) => {
    const published = answering(server, "publishPolicy", { revision_id: "polrev_1" });
    const input = { operation: OPERATION, config: {} } as const;

    await new PolicyService(client, "proj_1").publish(input);

    expect(
      published.map(({ body, url }) => {
        return [body, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([[input, { project_id: "proj_1" }]]);
  });
});

describe("PolicyService.evaluate", () => {
  it("answers what the policy decided about the input", async ({ server, client }) => {
    const evaluated = answering(server, "evaluatePolicy", { allowed: true });

    await expect(
      new PolicyService(client, "proj_1").evaluate({
        operation: OPERATION,
        config: {},
        input: { password: "hunter2" },
      }),
    ).resolves.toEqual({ allowed: true });
    expect(
      evaluated.map(({ body, url }) => {
        return [body, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([
      [
        { operation: OPERATION, config: {}, input: { password: "hunter2" } },
        { project_id: "proj_1" },
      ],
    ]);
  });
});
