import { describe, expect, it } from "vitest";

import { createSanitiser } from "./index.js";
import { NativeSanitiser } from "./native.js";

describe("createSanitiser", () => {
  it("uses the browser's Sanitizer API where setHTML() exists", async () => {
    expect(await createSanitiser()).toBeInstanceOf(NativeSanitiser);
  });
});
