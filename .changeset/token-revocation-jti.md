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
  looks up the token's `jti` and rejects it when the record is expired or gone.
  Only the id is stored — never the token, and never a hash of it (ADR 029).
- **Revocation deletes the record.** A revoked token resolves to nothing, which
  is the same answer an unknown token gets — all a bearer should learn either
  way — and the tokens table keeps no rows that grant anything (ADR 037).
- **Deleting a session revokes the tokens it issued**, in one transaction, so no
  token record outlives the session it authenticates. Rotating a session token
  likewise revokes its predecessor, so a rotated-out token stops working the
  moment its successor is issued.
- **Project and preview secrets are revocable.** They are now issued with a
  stored `jti`, so a leaked secret can be retired instead of living forever —
  these credentials have no expiry of their own. The console's publishable key
  is the project's preview credential re-encrypted, not a new one per request,
  so revoking the preview secret retires the published key with it.

Expired records are never honoured — verification checks `expires_at` too. There
is no background sweeper yet (#803), so records that expired without being revoked
accumulate; purging them once they are past `expires_at` is safe (verification
already rejects them) and is tracked in zitadel/nextgen#800.

**Compatibility:** project secrets issued before this change carry no `jti`.
They keep working — they cannot be forged without the encryption key — but
cannot be revoked until they are reissued. Rotate any secret you need to be able
to revoke. Session tokens already carried a `jti` and are unaffected.
