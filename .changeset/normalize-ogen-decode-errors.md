---
"@zitadel/server": patch
---

Normalize ogen decode/validation failures to the stable `req.invalid` domain message, and name the offending field in flow `Fields` JSON decode errors without echoing `json.Unmarshal` parser text (ADR 030).
