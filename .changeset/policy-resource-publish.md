---
"@zitadel/server": minor
---

Projects can now publish a password policy through the API. `POST /policies?project_id=…` with `{"operation": "auth.factor.password.set", "config": {"min_length": 12, "max_length": 32, "history_depth": 4}}` publishes a new revision, and `GET /policies/revisions/{revision_id}?project_id=…` reads one back. Every setting is optional and off when left out, and `{}` switches the policy off. An out-of-range or unknown setting answers `req.invalid`, and contradicting settings answer `pol.invalid`. The newest revision applies the next time a password is set, through the API or during sign-up; existing passwords are not re-checked. `history_depth` only counts when users change their own password, which the password change journey will bring. The new scopes are `policy.read` and `policy.write`.
