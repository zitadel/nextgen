---
"@zitadel/server": minor
---

Tokens can now be revoked, and revocation is enforced when they are verified.

Previously a token was accepted on decryption alone. Decryption proves only that
this deployment minted the token — it says nothing about whether the grant still
stands. Revoking a session deleted the session row but left its token record
behind, and `GET /users/me` reads the user named in the token without checking
that the session still exists, so a revoked session's cookie kept working until
its own expiry passed. It no longer does.

- **Verification resolves the token id.** For revocable token types the verifier
  looks up the token's `jti` and rejects it when the record is revoked, expired,
  or gone. Only the id is stored — never the token, and never a hash of it
  (ADR 029).
- **Revocation marks, it does not delete.** A revoked record is kept with
  `revoked_at` set, so a replayed token stays distinguishable from an unknown
  one — the groundwork for refresh-token replay detection (ADR 037).
- **Deleting a session revokes the tokens it issued**, in one transaction, so no
  token record outlives the session it authenticates *as a working credential*.
  The records themselves are kept and marked revoked — a database cascade would
  have deleted them, which is exactly the "unknown" answer revocation exists to
  avoid. Rotating a session token likewise revokes its predecessor rather than
  deleting it, so replaying a rotated-out token is detectable.
- **Project and preview secrets are revocable.** They are now issued with a
  stored `jti`, so a leaked secret can be retired instead of living forever —
  these credentials have no expiry of their own.

Expired records are never honoured — verification checks `expires_at` as well as
`revoked_at`. There is no background sweeper yet, so revoked and expired records
accumulate; purging them once they are past `expires_at` is safe (an unknown
token is rejected the same way a revoked one is) and is left as follow-up work.

**Compatibility:** project secrets issued before this change carry no `jti`.
They keep working — they cannot be forged without the encryption key — but
cannot be revoked until they are reissued. Rotate any secret you need to be able
to revoke. Session tokens already carried a `jti` and are unaffected.
