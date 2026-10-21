---
"@zitadel/server": minor
---

A password longer than 64 characters is now rejected with the error code `user.password_policy_violation` instead of `user.password_too_long` when it is set through the API (`PUT /users/{user_id}/password`); the response's `details.details` holds `{"violations": {"max_length": 64}}`. During sign-up, with a password or through a social provider, the same rejection now appears as an error on the sign-up step instead of the request failing; in the default sign-up flow that is the step with the password field, so the user can choose another password. Clients that match on `user.password_too_long` for over-long passwords should also handle `user.password_policy_violation`; `user.password_too_long` remains for passwords the project's hashing method cannot take.
