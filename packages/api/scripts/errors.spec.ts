import { describe, expect, it } from "vitest";

import { definedErrorSchemas, errorClassName, errorCodes, errorsSource } from "./errors";

describe("errorClassName", () => {
  it.each([
    ["proj.not_found", "ProjNotFoundError"],
    ["claim_challenge.not_found", "ClaimChallengeNotFoundError"],
    ["internal", "InternalError"],
    ["proj.claim-expired", "ProjClaimExpiredError"],
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

describe("definedErrorSchemas", () => {
  it("finds a code that no operation references, such as the one for a path the server lacks", async () => {
    expect(errorCodes(await definedErrorSchemas())).toEqual(
      expect.arrayContaining(["req.not_found", "req.method_not_allowed", "proj.not_found"]),
    );
  });
});

describe("errorsSource", () => {
  it("makes a class and a lookup entry for each code", () => {
    const source = errorsSource(["proj.not_found"]);

    expect(source).toContain("export class ProjNotFoundError extends ApiError");
    expect(source).toContain('"proj.not_found": ProjNotFoundError,');
  });

  it.each([
    ["api", "ApiError"],
    ["1st.failure", "1stFailureError"],
    ["a b", "A bError"],
  ])("refuses the code %s, whose class %s cannot be declared", (code, name) => {
    expect(() => errorsSource([code])).toThrow(name);
  });

  it("refuses two codes that make one class name", () => {
    expect(() => errorsSource(["proj.not_found", "proj_not.found"])).toThrow(/ProjNotFoundError/);
  });
});
