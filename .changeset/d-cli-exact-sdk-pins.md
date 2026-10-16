---
"@zitadel/cli": minor
---

`setup` now pins every framework's Zitadel SDK at the CLI's own version, as it already did for
Next.js, instead of the floating `alpha` tag. The app stays on the SDK that matches the files the
CLI wrote, and `doctor` warns when the CLI and the pinned SDK drift apart.
