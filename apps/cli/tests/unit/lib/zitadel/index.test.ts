import { describe, expect, it } from "vitest";

import {
  claimName,
  environmentVariable,
  flowName,
  objectType,
  propertyName,
  propertyPath,
  schemaReference,
  stepName,
} from "@/lib/zitadel";

describe("the zitadel library", () => {
  it.each([
    ["claimName", claimName],
    ["environmentVariable", environmentVariable],
    ["flowName", flowName],
    ["objectType", objectType],
    ["propertyName", propertyName],
    ["propertyPath", propertyPath],
    ["schemaReference", schemaReference],
    ["stepName", stepName],
  ])("exports %s, so a caller can brand a name without a cast", (_name, brand) => {
    const branded = brand("given");

    expect(branded).toBe("given");
  });
});
