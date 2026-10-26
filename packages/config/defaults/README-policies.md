# `.zitadel/policies/`

This folder holds your project's operation policies: the rules Zitadel checks
before an operation runs. One file per operation, named after it.

`auth.factor.password.set.json` is the password policy, checked whenever a
password is set: at sign-up, through the API, and by a user changing their own.

``` json
{
  "$schema": "../meta/policy.json",
  "operation": "auth.factor.password.set",
  "config": {}
}
```

## Settings

Every setting is optional. A setting left out is off, and `"config": {}`
switches every rule off, so the file above enforces nothing. Zitadel has no
default: what this file sets is what applies.

| Setting | What it does | Bounds |
| --- | --- | --- |
| `min_length` | The fewest characters a new password may have, counted as Unicode code points after NFC normalization. | 1 to 64 |
| `max_length` | The most characters a new password may have. A password above 64 characters is refused either way. | 1 to 64 |
| `history_depth` | How many of the user's passwords, the current one included, a new one may not repeat. Checked only when users set their own password. | 1 to 4 |

`min_length` may not be above `max_length`. The bounds are technical limits,
not recommendations. Common minimums range from 8 to 15 characters, and run
longer when the password is the only factor.

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
