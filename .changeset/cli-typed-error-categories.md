---
"@zitadel/cli": patch
---

Failures now report the right kind more consistently. A missing `zitadel.json`, `package.json`, `angular.json` or Vite config reports `E_NOT_FOUND` (exit 4). A proxy-credential or not-a-regular-file refusal and a server that fails to stop report `E_CONFLICT`. A `501` from the server reports as unsupported, and an unreadable record reports `E_AUTH` only when permission is the cause. Hints for the local server and environments no longer name flags, a Node `AbortError` reports as cancelled, and a cancelled prompt now stops the whole run.
