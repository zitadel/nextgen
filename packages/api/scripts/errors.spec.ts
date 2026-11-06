import { describe, expect, it } from "vitest";

import { errorClassName, errorCodes, errorsSource } from "./errors";

describe("errorClassName", () => {
  it.each([
    ["proj.not_found", "ProjNotFoundError"],
    ["claim_challenge.not_found", "ClaimChallengeNotFoundError"],
    ["internal", "InternalError"],
  ])("makes %s the class %s", (code, name) => {
    expect(errorClassName(code)).toBe(name);
  });
});

describe("errorCodes", () => {
  it("finds a code wherever the schema sits, once, sorted", () => {
    const inline = { type: "object", properties: { code: { const: "proj.not_found" } } };
    const document = {
      components: { schemas: { a: inline } },
      paths: {
        "/p": {
          get: {
            responses: {
              default: {
                content: {
                  "application/json": {
                    schema: {
                      oneOf: [
                        inline,
                        {
                          allOf: [
                            {
                              properties: { code: { type: "string", const: "auth.unauthorized" } },
                            },
                          ],
                        },
                        { properties: { code: { type: "string" } } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(errorCodes(document)).toEqual(["auth.unauthorized", "proj.not_found"]);
  });
});

describe("errorsSource", () => {
  it("makes a class and a lookup entry for each code", () => {
    const source = errorsSource(["proj.not_found"]);

    expect(source).toContain("export class ProjNotFoundError extends ApiError");
    expect(source).toContain('"proj.not_found": ProjNotFoundError,');
  });

  it("refuses two codes that make one class name", () => {
    expect(() => errorsSource(["proj.not_found", "proj_not.found"])).toThrow(/ProjNotFoundError/);
  });
});
