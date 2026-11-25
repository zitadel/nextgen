---
title: The server logs every error it answers
summary: A self-hosted server now writes an api error log line, with its cause and where it was raised, for every error it answers, refused sign-in steps included.
date: 2026-11-05T11:15Z
cloud: true
pulls: [2534, 2716]
---

The server now writes an `api error` log line for every error it answers, so you can find out why a request failed from the server's log.

- That includes a sign-in step it refuses, such as a wrong password, a rejected passkey or a failed external sign-in, a refusal with its own response body, a path or method no operation serves, and the external sign-in callback.
- Each line carries the error's cause and the place it was raised, and shares the `request_id` of the request's `request served` line, which holds the status.
- When an identity provider refuses the code exchange, the line includes the provider's `error_description`, such as `invalid client_id / client_secret` for a wrong client secret.
- Values a user submitted, such as an email or a pasted client secret, are left out.
