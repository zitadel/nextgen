import { afterEach, describe, expect, it, vi } from "vitest";

import { DomPurifySanitiser } from "./dompurify.js";
import { createSanitiser } from "./index.js";
import { NativeSanitiser } from "./native.js";

/**
 * Gives the page an `Element.setHTML()` and the given `Sanitizer`, as a
 * browser with some version of the HTML Sanitizer API has.
 *
 * @param sanitizer - The `Sanitizer` constructor the browser exposes.
 */
function withSanitizerApi(sanitizer: unknown): void {
  Object.defineProperty(Element.prototype, "setHTML", { value: () => {}, configurable: true });
  vi.stubGlobal("Sanitizer", sanitizer);
}

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "setHTML");
  vi.unstubAllGlobals();
});

describe("createSanitiser", () => {
  it("falls back to DOMPurify where the browser has no setHTML()", async () => {
    expect(await createSanitiser()).toBeInstanceOf(DomPurifySanitiser);
  });

  it("falls back to DOMPurify where setHTML() belongs to an earlier draft of the API", async () => {
    // Chrome 105 to 118: setHTML() and a Sanitizer configured through its constructor only.
    withSanitizerApi(class {});

    expect(NativeSanitiser.isSupported()).toBe(false);
    expect(await createSanitiser()).toBeInstanceOf(DomPurifySanitiser);
  });

  it("falls back to DOMPurify where the browser's Sanitizer rejects the configuration", async () => {
    withSanitizerApi(
      class {
        get(): object {
          return {};
        }
        allowElement(): void {
          throw new TypeError("Invalid sanitizer configuration");
        }
        allowAttribute(): void {}
        removeElement(): void {}
        replaceElementWithChildren(): void {}
        setDataAttributes(): void {}
        setComments(): void {}
      },
    );

    expect(NativeSanitiser.isSupported()).toBe(true);
    expect(await createSanitiser()).toBeInstanceOf(DomPurifySanitiser);
  });
});
