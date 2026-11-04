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

  it("escapes a hostile string at any depth of a response", async () => {
    stubFetch(200, {
      name: "\u001b[2Jwiped",
      nested: {
        tags: ["ok", "\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007"],
        "key\u001b": [{ deep: "\u009b31m" }],
      },
    });

    await expect(client().getProject("p1")).resolves.toEqual({
      name: "\\x1b[2Jwiped",
      nested: {
        tags: ["ok", "\\x1b]8;;https://evil.example\\x07click\\x1b]8;;\\x07"],
        "key\\x1b": [{ deep: "\\x9b31m" }],
      },
    });
  });

  it("keeps two keys apart when one spells out the other's escape", async () => {
    stubFetch(200, { "k\u001b": 1, "k\\x1b": 2, "a\\b": 3 });

    await expect(client().getProject("p1")).resolves.toEqual({
      "k\\x1b": 1,
      "k\\\\x1b": 2,
      "a\\\\b": 3,
    });
  });

  it("walks a response nested deeper than the call stack", async () => {
    const depth = 20_000;
    // Sent as text: `JSON.stringify` itself cannot serialise this depth.
    const text = `${"[".repeat(depth)}"\\u001b"${"]".repeat(depth)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(text, { status: 200 })),
    );

    const node = Array.from({ length: depth }).reduce<unknown>(
      (inner) => (inner as unknown[])[0],
      await client().getProject("p1"),
    );
    expect(node).toBe("\\x1b");
  });

  it("keeps a __proto__ key as a field", async () => {
    stubFetch(200, JSON.parse('{"__proto__": {"polluted": "\\u001b"}}'));

    const body = (await client().getProject("p1")) as Record<string, unknown>;

    expect(Object.getOwnPropertyNames(body)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps newlines and tabs and leaves non-strings untouched", async () => {
    stubFetch(200, { description: "line one\n\tline two", count: 3, active: true, gone: null });

    await expect(client().getProject("p1")).resolves.toEqual({
      description: "line one\n\tline two",
      count: 3,
      active: true,
      gone: null,
    });
  });

  it("returns bodies untouched when asked for them verbatim", async () => {
    const body = { liquid_template: "<p>\r\n\u200d\u001b[2J</p>" };
    stubFetch(200, body);

    const verbatim = createZitadelClient(
      { baseUrl: "http://localhost:8080", token: "t", signal },
      { verbatim: true },
    );

    await expect(verbatim.getProject("p1")).resolves.toEqual(body);
  });

  it("escapes the server's text in a rejected call even for a verbatim client", async () => {
    stubFetch(404, { code: "not_found", message: "no \u001b[2Jproject" });

    const verbatim = createZitadelClient(
      { baseUrl: "http://localhost:8080", token: "t", signal },
      { verbatim: true },
    );

    await expect(verbatim.getProject("p1")).rejects.toMatchObject({
      status: 404,
      body: { message: "no \\x1b[2Jproject" },
    });
  });

  it("escapes the server's text in a rejected call and raises it as a BackendError", async () => {
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
        message: "bad \\x1b[31mname",
        details: { details: "\\x1b]52;c;cHduZWQ=\\x07" },
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
