import { describe, expect, test } from "vitest";

import { CHECKS, exemptionsFor, REFUSALS, refusalsFor } from "./checks";

describe("CHECKS", () => {
  test("names every check, and never the speed limit `all` would add", () => {
    expect(CHECKS).toContain("not_a_server_error");
    expect(CHECKS).toContain("ignored_auth");
    expect(CHECKS).not.toContain("max_response_time");
    expect(CHECKS).toHaveLength(14);
  });
});

describe("exemptionsFor", () => {
  test("switches ignored_auth off for an operation that takes either of two credentials, and no other", () => {
    expect(
      exemptionsFor([
        { id: "getFlow", alternatives: 2 },
        { id: "deleteTeam", alternatives: 1 },
        { id: "getReady", alternatives: 0 },
      ]),
    ).toEqual([{ operationId: "getFlow", check: "ignored_auth" }]);
  });

  test("adds the named exemptions of the operations it is given, and no others", () => {
    expect(
      exemptionsFor([
        { id: "getTeam", alternatives: 1 },
        { id: "getUser", alternatives: 1 },
      ]),
    ).toEqual([{ operationId: "getTeam", check: "use_after_free" }]);
  });

  test("exempts rollbackDeployment from negative data rejection", () => {
    expect(exemptionsFor([{ id: "rollbackDeployment", alternatives: 1 }])).toEqual([
      { operationId: "rollbackDeployment", check: "negative_data_rejection" },
    ]);
  });
});

describe("refusalsFor", () => {
  test("gives the ids of the refusing operations among a family's, and no others", () => {
    expect(
      refusalsFor([
        { name: "POST /users", id: "createUser" },
        { name: "GET /users/{id}", id: "getUser" },
        { name: "POST /idps", id: "createIdp" },
      ]),
    ).toEqual(["createUser", "createIdp"]);
  });

  test("leaves out the operations that take a page token, which the hook keeps a token out of", () => {
    expect(Object.keys(REFUSALS)).not.toContain("GET /deployments");
    expect(Object.keys(REFUSALS)).not.toContain("POST /users/query");
  });

  test("gives every refusal a reason", () => {
    Object.values(REFUSALS).forEach((reason) => {
      expect(reason.length).toBeGreaterThan(10);
    });
  });
});
