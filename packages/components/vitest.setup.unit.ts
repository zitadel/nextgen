/**
 * Unit-project (jsdom) test setup.
 *
 * jsdom 29 implements `crypto.getRandomValues` but not `crypto.subtle`.
 * The captcha gate path needs `subtle.digest` on both sides — `<zl-captcha>`
 * solves the Altcha proof-of-work, and the api-mock fixtures mint one per
 * identifier-step render — so back the global with Node's WebCrypto, which
 * is spec-identical. The browser project runs real Chromium and never loads
 * this file.
 */
import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
