---
"@zitadel/cli": patch
---

Clarify embedded login design guidance. The generated AGENTS.md gains a
"theming the widgets from your app" section (the `--zl-*` token bridge
through the shadow DOM, the `suppress-header` knob, and how starter designs
collapse by container width), and the Next session-state paragraph explains
extending the request-boundary `matcher` for server-rendered header chrome.
The `--design` flag help and the wizard hints now state what split-family
designs show at card width (compact brand mark: `logo_url`, else `hero_url`;
`hero` falls back to editable text), setup emits a warning when a
widget-posture app picks `split`/`split-right`, and the scaffolded
widget-posture pages mention `suppress-header` next to the variant/theme
comment.
