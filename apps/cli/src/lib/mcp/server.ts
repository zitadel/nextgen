import { PassThrough, type Readable, type Writable } from "node:stream";

import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { send } from "../api/call";
import { urlOf } from "../api/request";
import { toZitadelError } from "../errors";
import { readsOnly, requestOf, type ToolDefinition, type ToolSelection, toolsFor } from "./tools";

/** What `zitadel mcp` serves, and with which credential. */
export type McpOptions = ToolSelection &
  Readonly<{
    /** The CLI's version, which the server reports as its own. */
    version: string;
    /** The API base the calls go to: the CLI's resolved server. */
    server: string;
    projectId: string;
    projectSecret: string;
    /** Answer a call that writes with the request it would send, and send it not; reads are sent. */
    dryRun: boolean;
  }>;

/** A server ready to connect, and the tools it lists. */
export type ZitadelMcp = Readonly<{
  mcp: McpServer;
  tools: readonly ToolDefinition[];
  /** Resolves once every call that has started has been answered. */
  settled: () => Promise<void>;
}>;

/**
 * The MCP server: one tool per operation `options` selects, each calling the
 * API as `zitadel api` does, with the project secret as the bearer.
 */
export const createZitadelMcp = (options: McpOptions): ZitadelMcp => {
  const tools = toolsFor(options);
  const mcp = new McpServer(
    { name: "zitadel", version: options.version },
    { instructions: instructionsOf(options) },
  );
  const calls = new Set<Promise<CallToolResult>>();
  for (const tool of tools) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        const call = callTool(tool, args as Record<string, unknown>, options);
        calls.add(call);
        try {
          return await call;
        } finally {
          calls.delete(call);
        }
      },
    );
  }
  return {
    mcp,
    tools,
    settled: async () => {
      // A request that came with the last chunk reaches its handler a tick
      // later, and an answered call's response is written a tick after that.
      await tick();
      while (calls.size > 0) {
        await Promise.allSettled([...calls]);
        await tick();
      }
    },
  };
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const instructionsOf = (options: McpOptions): string =>
  [
    `Each tool is one operation of the Zitadel API at ${options.server}, called with the project secret of project ${options.projectId}; a project_id you leave out is that project.`,
    "A tool's name is the operation's operationId, as the API reference names it.",
    options.writes
      ? "Tools that create, change or delete are offered: confirm with the user before calling one."
      : "Only operations that read are offered.",
    options.dryRun
      ? "A call that would create, change or delete is not sent: it answers with the request it would make."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

/**
 * One call: the response body as JSON text, or, for a refused request, an
 * error result carrying the status and the server's error body, which names
 * the error's code, so the agent can correct the call.
 */
const callTool = async (
  tool: ToolDefinition,
  args: Readonly<Record<string, unknown>>,
  options: McpOptions,
): Promise<CallToolResult> => {
  const request = requestOf(tool.operation, args, options.projectId);
  if (options.dryRun && !readsOnly(tool.operation)) {
    return text({
      method: tool.operation.method,
      url: urlOf(options.server, request),
      ...(request.body === undefined ? {} : { body: request.body }),
    });
  }
  const token = tool.operation.auth === "secret" ? options.projectSecret : undefined;
  try {
    const response = await send(options.server, token, request);
    return response.body === undefined
      ? { content: [{ type: "text", text: `No content (${response.status}).` }] }
      : text(response.body);
  } catch (error) {
    if (error instanceof ApiError) {
      return { ...text({ status: error.status, error: error.body }), isError: true };
    }
    const failure = toZitadelError(error);
    return {
      ...text({ code: failure.code, message: failure.message, hint: failure.hint }),
      isError: true,
    };
  }
};

const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

/**
 * Serve `zitadel` on stdio until the client closes its end, then answer the
 * calls still running before closing: a client may write its requests and
 * close stdin at once (`… | zitadel mcp`), as a script does.
 */
export const serveStdio = async (
  served: ZitadelMcp,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<void> => {
  const input = new PassThrough();
  const ended = new Promise<void>((resolve) => {
    stdin.once("end", resolve);
    stdin.once("close", resolve);
  });
  stdin.pipe(input, { end: false });
  await served.mcp.connect(new StdioServerTransport(input, stdout));
  await ended;
  await served.settled();
  await served.mcp.close();
};
