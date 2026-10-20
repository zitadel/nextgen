import type { ZitadelFlowInputEventDetail } from "@zitadel/components";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { ZitadelFlowInputDetail } from "./types.js";

describe("ZitadelFlowInputDetail", () => {
  it("types a secret flow input without a value", () => {
    expectTypeOf<Extract<ZitadelFlowInputDetail, { secret: true }>>().not.toHaveProperty("value");
    // @ts-expect-error a secret field has no value to read
    const leak = (detail: ZitadelFlowInputDetail): string => detail.value;
    expect(leak).toBeTypeOf("function");
  });

  it("offers the value only once the field is narrowed to a non-secret one", () => {
    const read = (detail: ZitadelFlowInputDetail): string | undefined =>
      detail.secret ? undefined : detail.value;

    expect(read({ name: "email", secret: false, value: "alice@acme.com" })).toBe("alice@acme.com");
    expect(read({ name: "password", secret: true })).toBeUndefined();
  });

  it("is the detail the element emits", () => {
    expectTypeOf<ZitadelFlowInputDetail>().toEqualTypeOf<ZitadelFlowInputEventDetail>();
  });
});
