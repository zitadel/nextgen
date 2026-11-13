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
switches every rule off. For passwords, Zitadel has no default: what this
file sets is what applies.

| Setting | What it does | Bounds |
| --- | --- | --- |
| `min_length` | The fewest characters a new password may have, counted as Unicode code points after NFC normalization. | 1 to 64 |
| `max_length` | The most characters a new password may have. A password above 64 characters is refused either way. | 1 to 64 |
| `history_depth` | How many of the user's passwords, the current one included, a new one may not repeat. Checked only when users set their own password. | 1 to 4 |

`min_length` may not be above `max_length`. The bounds are technical limits,
not recommendations. NIST SP 800-63B asks for at least 15 characters when the
password is the only factor, and at least 8 when it is always used with a
second one.

## The sign-up policy

`user.create.json` is the sign-up policy, checked before a sign-up in your
login creates a user. `zitadel setup` writes it as Zitadel's default:

``` json
{
  "$schema": "../meta/policy.json",
  "operation": "user.create",
  "config": { "challenge": "zitadel_pow" }
}
```

Every sign-up with a password or a passkey solves a proof of work in the
browser before Zitadel creates the user, and each sign-up flow is limited in
how often it can try. Zitadel applies both with or without this file, so
deleting it, or deploying `"config": {}`, protects sign-ups the same way. The
file shows that protection where you keep your other settings. Sign-ups through
a sign-in provider are not challenged: each needs an account at the provider.

| Setting | What it does | Values |
| --- | --- | --- |
| `challenge` | The challenge a sign-up with a password or a passkey must solve before the user is created. | `zitadel_pow`, the built-in proof of work |

Users your backend creates through the API are never challenged: its
credentials already name the caller.

## Publishing

Edit the file, then run `zitadel deploy --dry-run` to see the change and
`zitadel deploy` to publish it. A password set from then on is checked
against the policy of the deployed release. Sign-ins, sign-ups and API calls
from your app get the release that serves their origin, a preview URL
included. The console and callers with no origin, such as the CLI, get your
newest primary deployment's. Passwords already stored are not checked again.

Your editor validates the file against `.zitadel/meta/policy.json`, and
`zitadel deploy` refuses an unknown setting, a value outside its bounds or a
file not named after its operation before anything is sent.

A policy keeps its revisions. Deploying without the file switches the policy
off for sign-ins, sign-ups and the API alike, and deploying the file again
brings it back.

## Testing a policy

`auth.factor.password.set.test.json` beside the policy holds cases you write:
an input, and the decision you expect. `zitadel policy test` sends each case
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
  current first). With `history_depth` 2 or more, a case with
  `"facts": { "history_matches": [false, true] }` checks that reusing the
  previous password is refused.
- `expect` takes `allowed`, and optionally the `code` the operation answers
  with (such as `user.password_empty`) and exactly the `violations` it reports.
  The decision and the rules hold wherever a password is set; the `code` is
  what an API call answers, while your app's sign-up shows the same rules as
  errors on the password field.
- A test of the sign-up policy, `user.create.test.json`, names the challenge
  each sign-up solved: `"input": { "solved_challenge": "zitadel_pow" }`.

`zitadel policy test --release <id>` runs the same cases against the policy a
release pins. Test the files before `zitadel preview` or `deploy`: a pull
request's `preview` applies its policy on that pull request's preview URLs, and
`deploy` on your app and for your backend. In CI, run the test in the
pull-request job before `preview`. Without a policy, the cases run against
none, which shows what would get through.
