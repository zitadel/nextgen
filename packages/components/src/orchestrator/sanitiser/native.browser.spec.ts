import { describe, expect, it } from "vitest";

import { SANITISER_CASES } from "../__fixtures__/sanitiser-cases.js";
import { NativeSanitiser } from "./native.js";

const supported = NativeSanitiser.isSupported();

describe("NativeSanitiser", () => {
  it.runIf(supported).each(SANITISER_CASES)("%s", (_name, input, expected) => {
    expect(new NativeSanitiser().sanitise(input)).toBe(expected);
  });
});
