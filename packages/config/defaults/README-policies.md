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

Edit the file, then run `zitadel plan` to see the change and `zitadel apply`
to publish it. Each publish is a new revision of the policy; the newest one
applies the next time a password is set. Passwords already stored are not
checked again.

Your editor validates the file against `.zitadel/meta/policy.json`, and
`zitadel plan` refuses an unknown setting or a value outside its bounds.

A policy cannot be deleted: its revisions stay. Removing the file leaves the
policy in place, so to switch it off, keep the file with `"config": {}` and
apply it.
