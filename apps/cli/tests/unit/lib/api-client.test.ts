import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@zitadel/api/runtime/fetch";

import { createZitadelClient, escapeControlCharacters } from "../../../src/lib/api-client";

/** Answer every request with one JSON body and status. */
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("escapeControlCharacters", () => {
  it("escapes C0, DEL, C1, format and separator characters", () => {
    expect(escapeControlCharacters("a\u0000\u001b\u007f\u009b\u200e\u202e\u2028\u2029b")).toBe(
      "a\\x00\\x1b\\x7f\\x9b\\u200e\\u202e\\u2028\\u2029b",
    );
  });

  it("keeps newline and tab unless asked to escape them", () => {
    expect(escapeControlCharacters("one\ntwo\tthree")).toBe("one\ntwo\tthree");
    expect(escapeControlCharacters("one\ntwo\tthree", { keepLayout: false })).toBe(
      "one\\x0atwo\\x09three",
    );
  });

  it("leaves ordinary text, including non-ASCII, alone", () => {
    expect(escapeControlCharacters("Zoë 日本 🚀")).toBe("Zoë 日本 🚀");
  });
});

describe("createZitadelClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const client = () => createZitadelClient({ baseUrl: "http://localhost:8080", token: "t" });

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
      { baseUrl: "http://localhost:8080", token: "t" },
      { verbatim: true },
    );

    await expect(verbatim.getProject("p1")).resolves.toEqual(body);
  });

  it("escapes the server's text in a rejected call even for a verbatim client", async () => {
    stubFetch(404, { code: "not_found", message: "no \u001b[2Jproject" });

    const verbatim = createZitadelClient(
      { baseUrl: "http://localhost:8080", token: "t" },
      { verbatim: true },
    );

    await expect(verbatim.getProject("p1")).rejects.toMatchObject({
      status: 404,
      body: { message: "no \\x1b[2Jproject" },
    });
  });

  it("escapes the server's text in a rejected call and keeps it an ApiError", async () => {
    stubFetch(400, {
      code: "invalid_argument",
      message: "bad \u001b[31mname",
      details: { details: "\u001b]52;c;cHduZWQ=\u0007" },
    });

    const error = await client()
      .getProject("p1")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
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
