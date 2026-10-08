---
"@zitadel/components": minor
---

Add a `manual-ceremony` attribute to `<zitadel-login>`. When set, the orchestrator renders a step's passkey challenge inert (`<zl-passkey manual>`) so the WebAuthn ceremony does not auto-start on mount — an operator preview or workbench can show the passkey screen without raising the OS `navigator.credentials` prompt, which can't complete there. Off by default; ordinary logins run the ceremony unchanged.
