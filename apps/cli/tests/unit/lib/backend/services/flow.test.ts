import { describe, expect, it, vi } from "vitest";

import { FlowService } from "@/lib/backend/services/flow";
import { type ClientStubs, fakeClient, pagesOf } from "@tests/helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): FlowService {
  return new FlowService(fakeClient(stubs), "proj_1");
}

describe("FlowService.list", () => {
  it("lists every flow of the project it is bound to, narrowed by the query", async () => {
    const all = vi.fn(async () => [{ id: "flowdef_1" }]);

    const flows = await service({ listFlowDefinitions: { all } }).list({ name: "default-login" });

    expect(all).toHaveBeenCalledWith({
      project_id: "proj_1",
      name: "default-login",
    });
    expect(flows).toEqual([{ id: "flowdef_1" }]);
  });

  it("drains past the first page, so a caller sees every flow", async () => {
    const flows = await service({
      listFlowDefinitions: {
        all: async () => [{ id: "flowdef_2" }, { id: "flowdef_1" }],
      },
    }).list();

    expect(flows).toEqual([{ id: "flowdef_2" }, { id: "flowdef_1" }]);
  });
});

describe("FlowService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const first = await service({
      listFlowDefinitions: {
        pages: () =>
          pagesOf(
            { flow_definitions: [{ id: "flowdef_2" }], next_page_token: "t2" },
            { flow_definitions: [{ id: "flowdef_1" }], next_page_token: null },
          ),
      },
    }).page();

    expect(first.items).toEqual([{ id: "flowdef_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async () => {
    const first = await service({
      listFlowDefinitions: {
        pages: () => pagesOf({ flow_definitions: [], next_page_token: null }),
      },
    }).page();

    expect(first.next).toBeNull();
  });
});

describe("FlowService.get", () => {
  it("fetches a revision id directly", async () => {
    const getFlowDefinition = vi.fn(async () => ({ id: "flowdef_1" }));

    await expect(service({ getFlowDefinition }).get("flowdef_1")).resolves.toEqual({
      id: "flowdef_1",
    });
    expect(getFlowDefinition).toHaveBeenCalledWith("flowdef_1");
  });

  it("takes the newest revision of a flow named by its name", async () => {
    const pages = vi.fn(() =>
      pagesOf({
        flow_definitions: [{ id: "flowdef_2" }, { id: "flowdef_1" }],
        next_page_token: null,
      }),
    );

    const flow = await service({ listFlowDefinitions: { pages } }).get("default-login");

    expect(flow).toEqual({ id: "flowdef_2" });
    expect(pages).toHaveBeenCalledWith({
      project_id: "proj_1",
      name: "default-login",
      limit: 1,
    });
  });

  it("refuses a name that matches no flow, saying how to see what the project has", async () => {
    await expect(
      service({
        listFlowDefinitions: {
          pages: () => pagesOf({ flow_definitions: [], next_page_token: null }),
        },
      }).get("typo"),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: 'No flow definition named "typo"',
      hint: "Run `flow-definitions list` to see the flows this project has.",
    });
  });
});

describe("FlowService.create", () => {
  it("sends the flow with the project it is bound to", async () => {
    const publishFlowDefinition = vi.fn(async () => ({ id: "flowdef_1" }));

    const flowDefinition = {
      name: "default-login",
      status: "active" as const,
      user_schema: "sch_1",
      purposes: { login: "step-1" },
      steps: [],
    };

    await service({ publishFlowDefinition }).create({ flow_definition: flowDefinition });

    expect(publishFlowDefinition).toHaveBeenCalledWith({
      flow_definition: flowDefinition,
      project_id: "proj_1",
    });
  });
});
