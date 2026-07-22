---
"@zitadel/server": patch
---

Normalize ogen decode/validation failures to the stable `req.invalid` domain message, and name the offending field on flow `Fields` value decode errors without echoing `json.Unmarshal` parser text (ADR 030).
