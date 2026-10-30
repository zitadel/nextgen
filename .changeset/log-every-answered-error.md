---
"@zitadel/server": minor
---

The server writes an `api error` log line for every error it answers. That includes a sign-in step it refuses (for example a wrong password, a rejected passkey or a failed external sign-in), a refusal with its own response body, a path or method no operation serves, and the external sign-in callback. Each line carries the error's cause and the place it was raised, and shares the `request_id` of the request's `request served` line, which holds the status. Values a user submitted, such as an email or a pasted client secret, are left out of these lines.
