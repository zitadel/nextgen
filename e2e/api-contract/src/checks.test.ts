import { describe, expect, test } from "vitest";

import { checksFor } from "./checks";

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
