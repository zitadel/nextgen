import { describe, expect, test } from "vitest";

import { FailureDetails } from "./details";

const log = [
  "some output",
  "=================================== FAILURES ===================================",
  "__________________________________ GET /livez __________________________________",
  "1. Test Case ID: atQLvu",
  "",
  "- Server error",
  "",
  "[500] Internal Server Error:",
  "",
  '    `{"code":"internal","message":"An unexpected error occurred."}`',
  "",
  "Reproduce with:",
  "",
  "    curl -X GET http://host.docker.internal:32811/api/v1/livez",
  "",
  "    st replay atQLvu",
  "",
  "____________________________ POST /projects/query _____________________________",
  "1. Test Case ID: N2jFBW",
  "",
  "- API rejected schema-compliant request",
  "",
  "    Valid data should have been accepted",
  "",
  "[400] Bad Request:",
  "",
  '    `{"code":"req.invalid"}`',
  "",
  "Reproduce with:",
  "",
  "    curl -X POST -H 'Authorization: s3cret' -H 'X-Zitadel-CSRF: t0ken' -H 'Cookie: c00kie' -d '{}' http://x/api/v1/projects/query",
  "",
  "    st replay N2jFBW",
  "2. Test Case ID: second",
  "",
  "- API rejected schema-compliant request",
  "",
  "Reproduce with:",
  "",
  "    curl -X POST http://x/api/v1/projects/query",
  "",
  "Test Phases:",
  "  ❌ Examples",
].join("\n");

describe("FailureDetails", () => {
  test("reads the response and the request of each failing operation", () => {
    expect(FailureDetails.parse(log)["GET /livez"]).toEqual([
      {
        id: "atQLvu",
        checks: ["Server error"],
        response:
          '[500] Internal Server Error\n{"code":"internal","message":"An unexpected error occurred."}',
        curl: "curl -X GET http://host.docker.internal:32811/api/v1/livez",
      },
    ]);
  });

  test("keeps every case of an operation, and says which checks each failed", () => {
    const cases = FailureDetails.parse(log)["POST /projects/query"];

    expect(cases?.map((detail) => detail.id)).toEqual(["N2jFBW", "second"]);
    expect(cases?.[0]?.checks).toEqual(["API rejected schema-compliant request"]);
  });

  test("leaves credentials and tokens out of the request", () => {
    const curl = FailureDetails.parse(log)["POST /projects/query"]?.[0]?.curl ?? "";

    expect(curl).not.toContain("s3cret");
    expect(curl).not.toContain("t0ken");
    expect(curl).not.toContain("c00kie");
    expect(curl).toContain("-H 'Authorization: [Filtered]'");
  });

  test("gives no details for output without a failure section", () => {
    expect(FailureDetails.parse("all passed")).toEqual({});
  });

  test("gives no response for a case the server never answered", () => {
    expect(FailureDetails.parse(log)["POST /projects/query"]?.[1]?.response).toBe("");
  });
});
