# `.zitadel/policies/`

This folder holds your project's operation policies: the rules Zitadel checks
before an operation runs. One file per operation, named after it, and
optionally a test file beside it (see [Testing a policy](#testing-a-policy)).

`auth.factor.password.set.json` is the password policy, checked whenever a
password is set: at sign-up, through the API, and by a user changing their own.
`zitadel setup` writes it with a minimum length of 15 characters, unless you
chose another minimum or none:

``` json
{
  "$schema": "../meta/policy.json",
  "operation": "auth.factor.password.set",
  "config": { "min_length": 15 }
}
```

## Settings

Every setting is optional. A setting left out is off, and `"config": {}`
switches every rule off. Zitadel has no default: what this file sets is what
applies.

| Setting | What it does | Bounds |
| --- | --- | --- |
| `min_length` | The fewest characters a new password may have, counted as Unicode code points after NFC normalization. | 1 to 64 |
| `max_length` | The most characters a new password may have. A password above 64 characters is refused either way. | 1 to 64 |
| `history_depth` | How many of the user's passwords, the current one included, a new one may not repeat. Checked only when users set their own password. | 1 to 4 |

`min_length` may not be above `max_length`. The bounds are technical limits,
not recommendations. NIST SP 800-63B asks for at least 15 characters when the
password is the only factor, and at least 8 when it is always used with a
second one.

## Publishing

Edit the file, then run `zitadel deploy --dry-run` to see the change and
`zitadel deploy` to publish it. Sign-ins and sign-ups on your app use the
policy the deployed release carries, from the next time a password is set;
a password set through the API, or before your first deploy, uses the newest
published revision. Passwords already stored are not checked again.

Your editor validates the file against `.zitadel/meta/policy.json`, and
`zitadel deploy` refuses an unknown setting, a value outside its bounds or a
file not named after its operation before anything is sent.

A policy keeps its revisions. Deploying without the file switches the policy
off for sign-ins and sign-ups, but not for a password set through the API,
which uses the newest revision: to switch it off everywhere, keep the file
with `"config": {}` and deploy it.

## Testing a policy

`auth.factor.password.set.test.json` beside the policy holds cases you write:
an input, and the decision you expect. `zitadel policies test` sends each case
to Zitadel, which evaluates it exactly as a real password set would, and
reports the ones that do not hold. Your editor validates the file against
`.zitadel/meta/policy-test.json`, and `zitadel deploy` never carries it.

``` json
{
  "$schema": "../meta/policy-test.json",
  "operation": "auth.factor.password.set",
  "cases": [
    {
      "name": "too short",
      "input": { "password": "short1" },
      "expect": { "allowed": false, "violations": ["min_length"] }
    },
    {
      "name": "15 characters, counted as written",
      "input": { "password": "Passwört-sicher" },
      "expect": { "allowed": true }
    }
  ]
}
```

- `input` is what the operation receives: the password itself, so the
  test also covers how it is counted (`Passwört-sicher` is 15 characters,
  though 16 bytes).
- `facts` is what a real password set would look up: `self_service`
  (default `true`, a user setting their own password) and `history_matches`
  (default `[]`, whether the password matches each of the user's kept ones,
  current first). With `history_depth` set, a case with
  `"facts": { "history_matches": [false, true] }` checks that reusing the
  previous password is refused.
- `expect` takes `allowed`, and optionally the `code` the operation answers
  with (such as `user.password_empty`) and exactly the `violations` it reports.
  The decision and the rules hold wherever a password is set; the `code` is
  what an API call answers, while your app's sign-up shows the same rules as
  errors on the password field.

`zitadel policies test --release <id>` runs the same cases against the policy a
built release pins, before you deploy it. Without a policy, the cases run
against none, which shows what would get through.
