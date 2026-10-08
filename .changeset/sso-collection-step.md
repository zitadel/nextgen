---
"@zitadel/server": minor
"@zitadel/api": patch
"@zitadel/components": minor
---

A step with `on_success: create_user_with_sso` now creates the user from a sign-in provider's identity. When `sso_user_not_found` routes an unlinked identity to this step, the step is prefilled with the provider's claims. Its submit creates the user from the submitted values and the claims the step does not show, links the provider account, and signs the user in. A password field on the step stores the password with the user. A claim that fails its property is left out. A changed unique value the provider verified is refused with `error.sso_verified_unique_value_changed`. A submitted unique value another user holds binds that user and routes `user_already_exists`. A taken value with no owner to bind gives `error.user_already_exists`. Values that fail the user schema only together give `error.sso_user_invalid`, and a required property the step does not collect gives `error.sso_user_cannot_be_created`. The login components translate the four new errors in English, German and Italian. The create flow and submit responses document more of the error codes they can return.