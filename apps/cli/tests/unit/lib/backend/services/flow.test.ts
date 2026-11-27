import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { NotFoundError } from "@/lib/backend/errors";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { FlowService } from "@/lib/backend/services/flow";
import { answering, answeringPages } from "@tests/helpers/api-answers";

describe("FlowService.list", () => {
  it("lists every flow of the project it is bound to, narrowed by the query", async ({
    server,
    client,
  }) => {
    const listed = answeringPages(server, "listFlowDefinitions", {
      flow_definitions: [{ id: "flowdef_1" }],
    });

    const flows = await new FlowService(client, "proj_1").list({ name: "default-login" });

    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([{ project_id: "proj_1", name: "default-login" }]);
    expect(flows).toEqual([{ id: "flowdef_1" }]);
  });

  it("drains past the first page, so a caller sees every flow", async ({ server, client }) => {
    answeringPages(
      server,
      "listFlowDefinitions",
      { flow_definitions: [{ id: "flowdef_2" }] },
      { flow_definitions: [{ id: "flowdef_1" }] },
    );

    const flows = await new FlowService(client, "proj_1").list();

    expect(flows).toEqual([{ id: "flowdef_2" }, { id: "flowdef_1" }]);
  });
});

describe("FlowService.page", () => {
  it("reads one page and the cursor to the next", async ({ server, client }) => {
    answering(server, "listFlowDefinitions", {
      flow_definitions: [{ id: "flowdef_2" }],
      next_page_token: "t2",
    });

    const first = await new FlowService(client, "proj_1").page();

    expect(first.items).toEqual([{ id: "flowdef_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async ({ server, client }) => {
    answeringPages(server, "listFlowDefinitions", { flow_definitions: [] });

    const first = await new FlowService(client, "proj_1").page();

    expect(first.next).toBeNull();
  });
});

describe("FlowService.get", () => {
  it("fetches a revision id directly", async ({ server, client }) => {
    const fetched = answering(server, "getFlowDefinition", { id: "flowdef_1" });

    await expect(new FlowService(client, "proj_1").get("flowdef_1")).resolves.toEqual({
      id: "flowdef_1",
    });
    expect(
      fetched.map(({ params }) => {
        return params.flow_definition_id;
      }),
    ).toEqual(["flowdef_1"]);
  });

  it("takes the newest revision of a flow named by its name", async ({ server, client }) => {
    const listed = answeringPages(server, "listFlowDefinitions", {
      flow_definitions: [{ id: "flowdef_2" }, { id: "flowdef_1" }],
    });

    const flow = await new FlowService(client, "proj_1").get("default-login");

    expect(flow).toEqual({ id: "flowdef_2" });
    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([{ project_id: "proj_1", name: "default-login", limit: "1" }]);
  });

  it("refuses a name that matches no flow, saying how to see what the project has", async ({
    server,
    client,
  }) => {
    answeringPages(server, "listFlowDefinitions", { flow_definitions: [] });

    const error = await rejectionOf(() => new FlowService(client, "proj_1").get("typo"));

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({
      name: "NotFoundError",
      message: 'No flow definition named "typo"',
      hint: "Run `flow-definition list` to see the flows this project has.",
    });
  });
});

describe("FlowService.create", () => {
  it("sends the flow with the project it is bound to", async ({ server, client }) => {
    const published = answering(server, "publishFlowDefinition", { id: "flowdef_1" });

    const flowDefinition = {
      name: "default-login",
      user_schema: "sch_1",
      purposes: { login: "step-1" },
      steps: [],
    };

    await new FlowService(client, "proj_1").create({ flow_definition: flowDefinition });

    expect(
      published.map(({ body }) => {
        return body;
      }),
    ).toEqual([{ flow_definition: flowDefinition, project_id: "proj_1" }]);
  });
});
