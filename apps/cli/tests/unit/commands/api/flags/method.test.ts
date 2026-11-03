import { describe, expect, it } from "vitest";

import {
  HTTP_METHODS,
  readMethod,
  methodFlag,
  METHOD_NOT_SENT_REFUSAL,
} from "../../../../../src/commands/api/flags/method";
import { interpolate } from "../../../../../src/lib/oclif/refusal";

describe("readMethod", () => {
  it.each(HTTP_METHODS)("accepts %s", (method) => {
    expect(readMethod(method)).toBe(method);
  });

  it("takes any case, as curl does", () => {
    expect(readMethod("delete")).toBe("DELETE");
  });

  it.each(["trace", "OPTIONS", ""])("refuses %j, naming it and the methods that exist", (value) => {
    expect(() => readMethod(value)).toThrow(
      interpolate(METHOD_NOT_SENT_REFUSAL.message, {
        value,
        methods: "GET, POST, PUT, PATCH, DELETE",
      }),
    );
  });
});

describe("methodFlag", () => {
  it("is wired to the validator", async () => {
    const defined = methodFlag({ name: "method" } as never) as unknown as {
      parse: (input: string, context: never, flag: unknown) => Promise<unknown>;
    };

    expect(await defined.parse("patch", {} as never, { name: "method" })).toBe("PATCH");
  });
});
