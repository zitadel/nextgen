import { randomUUID } from "node:crypto";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  id?: JsonRpcId;
  jsonrpc?: string;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  id: JsonRpcId;
  jsonrpc: "2.0";
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type InitializeParams = {
  capabilities?: Record<string, unknown>;
  clientInfo?: {
    name?: string;
    version?: string;
  };
  protocolVersion?: string;
};

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

const sessions = new Set<string>();

function negotiateProtocolVersion(requested?: string): string {
  if (requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number])) {
    return requested;
  }
  return "2025-06-18";
}

function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined;
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function createSessionId(): string {
  const sessionId = randomUUID();
  sessions.add(sessionId);
  return sessionId;
}

export function isKnownSession(sessionId: string | undefined): boolean {
  return sessionId !== undefined && sessions.has(sessionId);
}

export function handleMcpMessage(
  message: JsonRpcRequest,
): { httpStatus: number; body?: JsonRpcResponse; sessionId?: string } {
  if (message.jsonrpc !== undefined && message.jsonrpc !== "2.0") {
    return {
      httpStatus: 200,
      body: jsonRpcError(message.id ?? null, -32600, "Invalid Request"),
    };
  }

  if (isNotification(message)) {
    if (message.method === "notifications/initialized") {
      return { httpStatus: 202 };
    }
    return { httpStatus: 202 };
  }

  const id = message.id ?? null;

  switch (message.method) {
    case "initialize": {
      const params = (message.params ?? {}) as InitializeParams;
      const sessionId = createSessionId();
      return {
        httpStatus: 200,
        sessionId,
        body: jsonRpcResult(id, {
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          protocolVersion: negotiateProtocolVersion(params.protocolVersion),
          serverInfo: {
            name: "zitadel-mcp-mock-server",
            version: "0.0.0",
          },
        }),
      };
    }
    case "tools/list":
      return {
        httpStatus: 200,
        body: jsonRpcResult(id, {
          tools: [
            {
              description: "Echo probe tool for OAuth and MCP handshake testing",
              inputSchema: {
                additionalProperties: false,
                properties: {
                  message: {
                    description: "Message to echo back",
                    type: "string",
                  },
                },
                type: "object",
              },
              name: "probe_echo",
            },
          ],
        }),
      };
    case "tools/call": {
      const params = (message.params ?? {}) as { arguments?: { message?: string }; name?: string };
      if (params.name !== "probe_echo") {
        return {
          httpStatus: 200,
          body: jsonRpcError(id, -32602, `Unknown tool: ${params.name ?? "(missing)"}`),
        };
      }
      const echoed = params.arguments?.message ?? "ok";
      return {
        httpStatus: 200,
        body: jsonRpcResult(id, {
          content: [
            {
              text: echoed,
              type: "text",
            },
          ],
          isError: false,
        }),
      };
    }
    case "ping":
      return {
        httpStatus: 200,
        body: jsonRpcResult(id, {}),
      };
    default:
      return {
        httpStatus: 200,
        body: jsonRpcError(id, -32601, `Method not found: ${message.method}`),
      };
  }
}

export function parseJsonRpcBody(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) {
    return body.filter((entry): entry is JsonRpcRequest => typeof entry === "object" && entry !== null);
  }
  if (typeof body === "object" && body !== null) {
    return [body as JsonRpcRequest];
  }
  return [];
}

export function dispatchMcpBody(body: unknown): {
  httpStatus: number;
  body?: JsonRpcResponse | JsonRpcResponse[];
  sessionId?: string;
} {
  const messages = parseJsonRpcBody(body);
  if (messages.length === 0) {
    return {
      httpStatus: 400,
      body: jsonRpcError(null, -32700, "Parse error"),
    };
  }

  const outcomes = messages.map((message) => handleMcpMessage(message));
  const sessionId = outcomes.find((outcome) => outcome.sessionId)?.sessionId;

  if (outcomes.every((outcome) => outcome.httpStatus === 202)) {
    return { httpStatus: 202, sessionId };
  }

  const responses = outcomes
    .map((outcome) => outcome.body)
    .filter((response): response is JsonRpcResponse => response !== undefined);

  if (responses.length === 1) {
    return {
      httpStatus: outcomes[0]?.httpStatus ?? 200,
      body: responses[0],
      sessionId,
    };
  }

  return {
    httpStatus: 200,
    body: responses,
    sessionId,
  };
}
