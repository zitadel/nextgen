import { describe, expect, it, vi } from "vitest";

import { PolicyService } from "@/lib/backend/services/policy";
import { type ClientStubs, fakeClient, pagesOf } from "@tests/helpers/fake-client";

/** The only operation the spec's policies guard. */
const OPERATION = "auth.factor.password.set";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): PolicyService {
  return new PolicyService(fakeClient(stubs), "proj_1");
}

describe("PolicyService.list", () => {
  it("lists every policy of the project it is bound to, narrowed by the query", async () => {
    const all = vi.fn(async () => [{ id: "pol_1" }]);

    const policies = await service({ listPolicies: { all } }).list({ operation: OPERATION });

    expect(all).toHaveBeenCalledWith({ project_id: "proj_1", operation: OPERATION });
    expect(policies).toEqual([{ id: "pol_1" }]);
  });

  it("drains past the first page, so a caller sees every policy", async () => {
    const policies = await service({
      listPolicies: { all: async () => [{ id: "pol_2" }, { id: "pol_1" }] },
    }).list();

    expect(policies).toEqual([{ id: "pol_2" }, { id: "pol_1" }]);
  });
});

describe("PolicyService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const first = await service({
      listPolicies: {
        pages: () =>
          pagesOf(
            { policies: [{ id: "pol_2" }], next_page_token: "t2" },
            { policies: [{ id: "pol_1" }], next_page_token: null },
          ),
      },
    }).page();

    expect(first.items).toEqual([{ id: "pol_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async () => {
    const first = await service({
      listPolicies: { pages: () => pagesOf({ policies: [], next_page_token: null }) },
    }).page();

    expect(first.next).toBeNull();
  });
});

describe("PolicyService.get", () => {
  it("reads the policy for the project it is bound to", async () => {
    const getPolicy = vi.fn(async () => ({ id: "pol_1" }));

    await service({ getPolicy }).get("pol_1");

    expect(getPolicy).toHaveBeenCalledWith("pol_1", { project_id: "proj_1" });
  });
});

describe("PolicyService.ofOperation", () => {
  it("answers the policy of one operation", async () => {
    const pages = vi.fn(() => pagesOf({ policies: [{ id: "pol_1" }], next_page_token: null }));

    await expect(service({ listPolicies: { pages } }).ofOperation(OPERATION)).resolves.toEqual({
      id: "pol_1",
    });
    expect(pages).toHaveBeenCalledWith({
      project_id: "proj_1",
      operation: OPERATION,
      limit: 1,
    });
  });

  it("answers nothing when the project has no policy for it", async () => {
    await expect(
      service({
        listPolicies: { pages: () => pagesOf({ policies: [], next_page_token: null }) },
      }).ofOperation(OPERATION),
    ).resolves.toBeUndefined();
  });
});

describe("PolicyService.revision", () => {
  it("reads one pinned revision for the project it is bound to", async () => {
    const getPolicyRevision = vi.fn(async () => ({ revision_id: "polrev_1" }));

    await service({ getPolicyRevision }).revision("polrev_1");

    expect(getPolicyRevision).toHaveBeenCalledWith("polrev_1", { project_id: "proj_1" });
  });
});

describe("PolicyService.publish", () => {
  it("sends the operation and its config as given", async () => {
    const publishPolicy = vi.fn(async () => ({ revision_id: "polrev_1" }));
    const input = { operation: OPERATION, config: {} } as const;

    await service({ publishPolicy }).publish(input);

    expect(publishPolicy).toHaveBeenCalledWith(input, { project_id: "proj_1" });
  });
});

describe("PolicyService.evaluate", () => {
  it("answers what the policy decided about the input", async () => {
    const evaluatePolicy = vi.fn(async () => ({ allowed: true }));

    await expect(
      service({ evaluatePolicy }).evaluate({
        operation: OPERATION,
        config: {},
        input: { password: "hunter2" },
      }),
    ).resolves.toMatchObject({ allowed: true });
    expect(evaluatePolicy).toHaveBeenCalledWith(
      { operation: OPERATION, config: {}, input: { password: "hunter2" } },
      { project_id: "proj_1" },
    );
  });
});
