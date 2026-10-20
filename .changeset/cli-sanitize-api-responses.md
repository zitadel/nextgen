---
"@zitadel/cli": patch
---

Escape terminal control characters in everything the server returns. A value anyone can write — a user's name, a branding field, a variable — could carry ESC or OSC sequences that cleared the screen, set the window title, wrote the clipboard or disguised a link when another person ran `list` or `get`. Every response body and server error message now has its C0 and C1 control characters, DEL, and format and bidi controls shown as `\xNN` or `\uNNNN`; newlines and tabs are kept. `--json` output carries the same escaped text.
