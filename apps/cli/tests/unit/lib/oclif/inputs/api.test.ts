import { describe, expect, it } from "vitest";

import { HTTP_METHODS, httpMethodFlag } from "../../../../../src/lib/oclif/inputs/api";

async function parseMethod(input: string) {
  const defined = httpMethodFlag({ name: "method" } as never) as unknown as {
    parse: (input: string, context: never, flag: unknown) => Promise<unknown>;
  };
  return defined.parse(input, {} as never, { name: "method" });
}

describe("-X", () => {
  it.each(HTTP_METHODS)("accepts %s", async (method) => {
    expect(await parseMethod(method)).toBe(method);
  });

  it("takes any case, as curl does", async () => {
    expect(await parseMethod("delete")).toBe("DELETE");
  });

  it("refuses another method, naming it and the ones that exist", async () => {
    await expect(parseMethod("trace")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "-X trace is not one of GET, POST, PUT, PATCH, DELETE",
    });
  });
});
