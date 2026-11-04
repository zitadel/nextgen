import { describe, expect, it } from "vitest";

import { Operation } from "../../../../src/lib/backend";
import { curlOf } from "../../../../src/commands/api/curl";
import { buildRequest } from "../../../../src/commands/api/request";

/** The request for `ref` with `fields`, as the command builds it. */
const requestFor = (ref: string, fields: string[] = []) => {
  return buildRequest({
    target: Operation.named(ref),
    fields,
    projectId: "proj_1",
  });
};

describe("curlOf", () => {
  it("reads the project secret from the environment, never writing it out", () => {
    expect(curlOf("http://localhost:8080", requestFor("createTeam", ["name=O'Brien"]))).toBe(
      [
        "curl -X POST 'http://localhost:8080/api/v1/teams?project_id=proj_1'",
        '-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"',
        "-H 'Content-Type: application/json'",
        `-d '{"name":"O'\\''Brien"}'`,
      ].join(" \\\n  "),
    );
  });

  it("sends no credential for an operation that needs none", () => {
    expect(curlOf("http://localhost:8080", requestFor("getLive"))).toBe(
      "curl -X GET 'http://localhost:8080/api/v1/livez'",
    );
  });
});
