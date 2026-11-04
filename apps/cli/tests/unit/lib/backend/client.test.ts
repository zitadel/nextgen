import { describe, expect, it, vi } from "vitest";

import {
  allowDestructive,
  createZitadelClient,
  type ZitadelClient,
} from "../../../../src/lib/backend";
import { InvalidError } from "../../../../src/lib/backend/errors";

const signal = new AbortController().signal;

/** Answer every request with one JSON body and status. */
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("createZitadelClient", () => {
  const client = () =>
    createZitadelClient({ signal, baseUrl: "http://localhost:8080", token: "t" });

  it("answers a body exactly as the server sent it", async () => {
    const body = {
      liquid_template: "<p>\r\n\u200d\u001b[2J</p>",
      nested: {
        tags: ["ok", "\u001b]8;;https://evil.example\u0007click"],
      },
    };
    stubFetch(200, body);

    await expect(client().getProject("p1")).resolves.toEqual(body);
  });

  it("raises a refused response as a BackendError carrying the server's text as it came", async () => {
    stubFetch(400, {
      code: "invalid_argument",
      message: "bad \u001b[31mname",
      details: { details: "\u001b]52;c;cHduZWQ=\u0007" },
    });

    const error = await client()
      .getProject("p1")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(InvalidError);
    expect(error).toMatchObject({
      status: 400,
      body: {
        code: "invalid_argument",
        message: "bad \u001b[31mname",
        details: { details: "\u001b]52;c;cHduZWQ=\u0007" },
      },
    });
  });
});

describe("a client's destructive operations", () => {
  const client = () =>
    createZitadelClient({ signal, baseUrl: "http://localhost:8080", token: "t" });

  it("are refused on the client, cast or not", () => {
    expect(() => (client() as unknown as Record<string, unknown>).deleteVariable).toThrow(
      "deleteVariable is destructive: reach it through allowDestructive",
    );
  });

  it("are refused when reached around the type", () => {
    expect(() => Reflect.get(client(), "revokeRelease")).toThrow(
      "revokeRelease is destructive: reach it through allowDestructive",
    );
  });

  it("are refused when reached through the property descriptor", () => {
    expect(() => Object.getOwnPropertyDescriptor(client(), "deleteVariable")).toThrow(
      "deleteVariable is destructive: reach it through allowDestructive",
    );
  });

  it("leave every other operation reachable, updates included", () => {
    expect(typeof client().getVariable).toBe("function");
    expect(typeof client().updateVariables).toBe("function");
  });

  it("are handed back by allowDestructive", () => {
    expect(typeof allowDestructive(client()).deleteVariable).toBe("function");
  });

  it("are not handed back for a client createZitadelClient did not make", () => {
    expect(() => allowDestructive({} as ZitadelClient)).toThrow(
      "Only a client createZitadelClient made can allow its destructive operations",
    );
  });
});
