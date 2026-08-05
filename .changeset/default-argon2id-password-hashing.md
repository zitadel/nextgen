---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Default password/secret hashing is now `argon2id` (RFC 9106 second recommended
option: `time=3`, `memory=64 MiB`, `threads=4`) instead of bcrypt, per ADR 029.
Bcrypt and legacy algorithms (scrypt, pbkdf2, sha2, md5, md5salted, phpass,
drupal7, argon2) stay registered as verifiers, so pre-existing hashes keep
validating and are transparently rehashed to argon2id on the next successful
verification. Configure `password_hasher.hasher.algorithm` (and
`password_hasher.verifiers`) to override — e.g. set `bcrypt` with `cost: 10` to
keep the previous behavior.
