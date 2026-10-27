import { describe, expect, it } from "vitest";

import { curlOf } from "../../../../src/lib/api/curl";
import { resolveTarget } from "../../../../src/lib/api/operations";
import { buildRequest } from "../../../../src/lib/api/request";

const requestFor = (ref: string, fields: string[] = []) =>
  buildRequest({ target: resolveTarget(ref), pathValues: {}, fields, projectId: "proj_1" });

describe("curlOf", () => {
  it("reads the project secret from the environment, never writing it out", () => {
    expect(curlOf("http://localhost:8080", requestFor("createTeam", ["name=O'Brien"]))).toBe(
      [
        "curl -X POST 'http://localhost:8080/teams?project_id=proj_1'",
        '-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"',
        "-H 'Content-Type: application/json'",
        `-d '{"name":"O'\\''Brien"}'`,
      ].join(" \\\n  "),
    );
  });

  it("sends no credential for an operation that needs none", () => {
    expect(curlOf("http://localhost:8080", requestFor("getLive"))).toBe(
      "curl -X GET 'http://localhost:8080/livez'",
    );
  });
});
