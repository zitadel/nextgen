import { describe, expect, it, vi } from "vitest";

import { FlowService } from "../../../../../src/lib/backend/services/flow";
import { type ClientStubs, fakeClient } from "../../../../helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): FlowService {
  return new FlowService(fakeClient(stubs), "proj_1");
}

describe("FlowService.list", () => {
  it("lists the flows of the project it is bound to, narrowed by the query", async () => {
    const listFlowDefinitions = vi.fn(async () => ({ flow_definitions: [] }));

    await service({ listFlowDefinitions }).list({ name: "default-login" });

    expect(listFlowDefinitions).toHaveBeenCalledWith({
      project_id: "proj_1",
      name: "default-login",
    });
  });

  it("answers one page and the cursor to the next", async () => {
    const page = await service({
      listFlowDefinitions: async () => ({
        flow_definitions: [{ id: "flowdef_1" }],
        next_page_token: "t2",
      }),
    }).list();

    expect(page.items).toEqual([{ id: "flowdef_1" }]);
    expect(page.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async () => {
    const page = await service({
      listFlowDefinitions: async () => ({ flow_definitions: [] }),
    }).list();

    expect(page.next).toBeNull();
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
    const listFlowDefinitions = vi.fn(async () => ({
      flow_definitions: [{ id: "flowdef_2" }, { id: "flowdef_1" }],
    }));

    const flow = await service({ listFlowDefinitions }).get("default-login");

    expect(flow).toEqual({ id: "flowdef_2" });
    expect(listFlowDefinitions).toHaveBeenCalledWith({
      project_id: "proj_1",
      name: "default-login",
      limit: 1,
    });
  });

  it("refuses a name that matches no flow, saying how to see what the project has", async () => {
    await expect(
      service({
        listFlowDefinitions: async () => ({ flow_definitions: [] }),
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
    const createFlowDefinition = vi.fn(async () => ({ id: "flowdef_1" }));

    const flowDefinition = {
      name: "default-login",
      status: "active" as const,
      user_schema: "sch_1",
      purposes: { login: "step-1" },
      steps: [],
    };

    await service({ createFlowDefinition }).create({ flow_definition: flowDefinition });

    expect(createFlowDefinition).toHaveBeenCalledWith({
      flow_definition: flowDefinition,
      project_id: "proj_1",
    });
  });
});
