import { PassThrough } from "node:stream";
import { text } from "node:stream/consumers";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createZitadelMcp, type McpOptions, serveStdio } from "../../../../src/lib/mcp/server";

const SERVER = "http://localhost:8080";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const OPTIONS: McpOptions = {
  version: "0.0.0-test",
  server: SERVER,
  projectId: "proj_1",
  projectSecret: "secret_1",
  writes: false,
  dryRun: false,
};

type Message = {
  id?: number;
  result?: {
    instructions?: string;
    tools?: { name: string }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

/**
 * Talks to the server as a stdio client does: initializes, sends `requests`
 * (ids from 2), closes stdin at once, and returns every answer by id.
 */
async function talk(
  requests: readonly { method: string; params?: unknown }[],
  options: Partial<McpOptions> = {},
): Promise<Map<number, Message>> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const lines = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    ...requests.map((request, index) => ({ jsonrpc: "2.0", id: index + 2, ...request })),
  ];
  const served = serveStdio(createZitadelMcp({ ...OPTIONS, ...options }), stdin, stdout);
  stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  await served;
  stdout.end();
  const answers = (await text(stdout))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Message);
  return new Map(
    answers.flatMap((answer) => (answer.id === undefined ? [] : [[answer.id, answer]])),
  );
}

const call = (name: string, args: Record<string, unknown>) => ({
  method: "tools/call",
  params: { name, arguments: args },
});

describe("zitadel mcp's server", () => {
  it("lists the read tools, and says whose project they act on", async () => {
    const answers = await talk([{ method: "tools/list" }]);

    expect(answers.get(1)?.result?.instructions).toContain("proj_1");
    const names = answers.get(2)?.result?.tools?.map(({ name }) => name);
    expect(names).toContain("GetUserByID");
    expect(names).not.toContain("DeleteUserByID");
  });

  it("calls the operation with the project secret, and answers with the response body", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(`${SERVER}/users/:userId`, ({ request, params }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({ id: params.userId, schema: "sch_1" });
      }),
    );

    const answers = await talk([call("GetUserByID", { user_id: "user_1" })]);

    expect(authorization).toBe("Bearer secret_1");
    expect(JSON.parse(answers.get(2)?.result?.content?.[0]?.text ?? "")).toEqual({
      id: "user_1",
      schema: "sch_1",
    });
  });

  it("answers a refused request with an error result that carries the server's error", async () => {
    server.use(
      http.get(`${SERVER}/users/:userId`, () =>
        HttpResponse.json({ code: "user.not_found", message: "no such user" }, { status: 404 }),
      ),
    );

    const answers = await talk([call("GetUserByID", { user_id: "user_1" })]);

    const result = answers.get(2)?.result;
    expect(result?.isError).toBe(true);
    expect(JSON.parse(result?.content?.[0]?.text ?? "")).toMatchObject({
      status: 404,
      error: { code: "user.not_found" },
    });
  });

  it("refuses arguments the operation's schema refuses, without calling the server", async () => {
    const answers = await talk([call("GetUserByID", { user_id: "not a user id" })]);

    const result = answers.get(2)?.result;
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toContain("user_id");
  });

  it("answers a write on a dry run with its request, and sends it not", async () => {
    const answers = await talk([call("DeleteUserByID", { user_id: "user_1" })], {
      writes: true,
      dryRun: true,
    });

    expect(JSON.parse(answers.get(2)?.result?.content?.[0]?.text ?? "")).toEqual({
      method: "DELETE",
      url: `${SERVER}/users/user_1`,
    });
  });

  it("still sends a read on a dry run", async () => {
    server.use(http.get(`${SERVER}/users/:userId`, () => HttpResponse.json({ id: "user_1" })));

    const answers = await talk([call("GetUserByID", { user_id: "user_1" })], { dryRun: true });

    expect(JSON.parse(answers.get(2)?.result?.content?.[0]?.text ?? "")).toEqual({ id: "user_1" });
  });

  it("answers every call a client sent before it closed stdin", async () => {
    server.use(
      http.get(`${SERVER}/users/:userId`, async ({ params }) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ id: params.userId });
      }),
    );

    const answers = await talk([
      call("GetUserByID", { user_id: "user_1" }),
      call("GetUserByID", { user_id: "user_2" }),
    ]);

    expect(answers.get(2)?.result?.content?.[0]?.text).toContain("user_1");
    expect(answers.get(3)?.result?.content?.[0]?.text).toContain("user_2");
  });
});
