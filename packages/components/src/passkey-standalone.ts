/**
 * The `<zl-passkey>` atom alone, as the self-contained
 * `dist/passkey-standalone.mjs` for a page that renders its own login form
 * and needs only the WebAuthn ceremony: the Go login SDK
 * (`packages/go/login`) embeds and serves this file. Nothing else: no
 * orchestrator, so no `liquidjs` or `dompurify`.
 */
import "./atoms/zl-passkey.js";
