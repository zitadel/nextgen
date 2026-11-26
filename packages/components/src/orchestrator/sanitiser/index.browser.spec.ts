import { describe, expect, it } from "vitest";

import { DomPurifySanitiser } from "./dompurify.js";
import { createSanitiser } from "./index.js";
import { NativeSanitiser } from "./native.js";

const supported = NativeSanitiser.isSupported();

describe("createSanitiser", () => {
  it.runIf(supported)("uses the browser's Sanitizer API where setHTML() exists", async () => {
    expect(await createSanitiser()).toBeInstanceOf(NativeSanitiser);
  });

  it.skipIf(supported)("loads DOMPurify where setHTML() does not exist", async () => {
    expect(await createSanitiser()).toBeInstanceOf(DomPurifySanitiser);
  });
});
