---
"@zitadel/server": minor
---

The server now measures its authentication and audit paths: how long validating a bearer credential takes and whether it was valid, revoked, invalid or failed; how often token records are checked and found active or revoked; how long verifying a password takes and whether it matched, matched and was rehashed, or did not match, for sign-ins and for the comparisons against remembered passwords on a password change; the outcome of every authentication proof by kind of check; how long resolving an encryption key not in the cache takes, by the key that wraps it; where every flow start, submit and render left the flow; and how long audit inserts take, with the events written counted per type. The Metrics section of the configuration guide lists each instrument with its attributes and values.
