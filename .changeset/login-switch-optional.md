---
"@zitadel/server": minor
"@zitadel/config": minor
"@zitadel/cli": minor
"@zitadel/components": minor
---

Flow definitions choose whether the login switches between sign-in and sign-up on its own, and a purpose switch no longer needs a `target`.

- **Optional switch:** a flow that serves both `login` and `register` may leave out `user_not_found` or `user_already_exists` on its entry steps. That email then stays on its step with an error instead of switching. `zitadel deploy --dry-run` warns about it and still deploys. A step that offers a provider that creates users still needs `user_already_exists` and `sso_user_not_found`, because a provider's sign-in raises them too.
- **Purpose-only switch:** `"register": { "purpose": "register" }` goes to that purpose's entry step. The scaffolded flows use this form, and `{ "target": …, "purpose": … }` keeps working.
- **More warnings, never errors:** `deploy --dry-run` also warns about `switch` and `pivot` transitions, which the engine does not run yet, and about the reserved purposes `recovery`, `profiling`, `reauth` and `link_account`.
- **Hide the switch notice:** `<zitadel-login>` shows no notice when its text is `""` in `locales`. An `""` under `en` hides it in every language.
- **Sign-up first:** `zitadel setup` and the docs send a new app's first visit to `/register`.
- **Preset:** the `passkey-first` preset drops a `user_not_found` transition its passkey step could never take.
