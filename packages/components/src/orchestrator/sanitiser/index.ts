/**
 * Layer 2 of the template security pipeline (`docs/design/flowengine/template-security.md`).
 *
 * Runs after Liquid finishes rendering and before the HTML is handed to Lit's
 * `unsafeHTML` directive. It uses the browser's own HTML Sanitizer API where it
 * exists, and loads DOMPurify only where it does not (Safari, and a browser
 * with an earlier draft of the API), as Chrome's guidance on sanitising
 * untrusted HTML recommends. Both enforce the allowlist
 * in `allowlist.ts`.
 */
import { DomPurifySanitiser } from "./dompurify.js";
import { NativeSanitiser } from "./native.js";
import type { Sanitiser } from "./sanitiser.js";

export type { Sanitiser };

/**
 * Creates the sanitiser for this browser. Callers should keep the result.
 *
 * The output is meant for the `<zitadel-login>` shadow root, so callers must
 * not inject it into the document itself.
 *
 * @returns The sanitiser.
 * @internal
 */
export async function createSanitiser(): Promise<Sanitiser> {
  if (NativeSanitiser.isSupported()) {
    try {
      return new NativeSanitiser();
    } catch {
      // A browser whose Sanitizer rejects the configuration: DOMPurify
      // enforces the same allowlist, so the page still renders.
    }
  }
  return DomPurifySanitiser.load();
}
