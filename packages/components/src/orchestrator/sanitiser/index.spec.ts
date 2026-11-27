import { describe, expect, it } from "vitest";

import { DomPurifySanitiser } from "./dompurify.js";
import { createSanitiser } from "./index.js";

describe("createSanitiser", () => {
  it("falls back to DOMPurify where the browser has no setHTML()", async () => {
    expect(await createSanitiser()).toBeInstanceOf(DomPurifySanitiser);
  });
});
