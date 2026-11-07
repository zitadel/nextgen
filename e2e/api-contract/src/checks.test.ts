import { describe, expect, test } from "vitest";

import { checksFor, REFUSALS, refusalsFor } from "./checks";

describe("checksFor", () => {
  test("applies every named check, and never the speed limit `all` would add", () => {
    expect(checksFor("session")).toContain("not_a_server_error");
    expect(checksFor("session")).not.toContain("max_response_time");
    expect(checksFor("session")).toHaveLength(14);
  });

  test("keeps the unauthenticated-request check where an operation has one credential", () => {
    expect(checksFor("public")).toContain("ignored_auth");
    expect(checksFor("session")).toContain("ignored_auth");
    expect(checksFor("logout")).toContain("ignored_auth");
  });

  test("drops it for the management family, whose operations take either of two credentials", () => {
    expect(checksFor("management")).not.toContain("ignored_auth");
    expect(checksFor("management")).toHaveLength(13);
  });
});

describe("refusalsFor", () => {
  test("names the refusing operations among a family's, and no others", () => {
    expect(
      refusalsFor([{ name: "POST /users" }, { name: "GET /users/{id}" }, { name: "POST /idps" }]),
    ).toEqual(["POST /users", "POST /idps"]);
  });

  test("gives every refusal a reason", () => {
    Object.values(REFUSALS).forEach((reason) => {
      expect(reason.length).toBeGreaterThan(10);
    });
  });
});
