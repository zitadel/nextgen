# ADR 029: Cryptography, secrets and key lifecycle

> **Status:** Proposed
> **Date:** 2026-06-24
> **Context:** cryptography, secrets and key lifecycle

## Context

Currently, there is not a unified architecture for generation, storage,
rotation, and publication of cryptographic materials. This ADR will define:
project/preview secret handling, KMS/envelope encryption boundaries, signing key
(JWKS) lifecycle and rotation, password hashing policy and rehash/migration
strategy, and crypto-agility/FIPS constraints. Without this, key rotation
mistakes, secret sprawl, and inconsistent hashing will threaten production
security and availability.

## Hashing Decisions

### Verify only data at rest

#### Passwords and secrets

Passwords and secrets generated or provided to authenticate against us should
not be stored in plain text in the database. Since these values should never
leave the system, it is sufficient to store a hash of the values.

For password hashing we use the [`passwap`](https://github.com/zitadel/passwap)
package. It provides all functionality to hash and migrate hashes of passwords.

A project admin should be able to configure which hashing method should be used.
This is so that a tenant can have specific requirements such as FIPS.

By default, we should use [`argon2id`](https://datatracker.ietf.org/doc/html/rfc9106)
for password/secret hashing.

#### Tokens

(Generated) Tokens should never be stored in the database. If a field is
required for revocation, this can be achieved by storing the token id (E.g.:
`jti`) or the signature of the token. Since the token id itself is not a secret,
it does not need to be hashed. Since the signature of a token is already a
cryptographic output, additional hashing is not required.

### Signatures

To ensure integrity of some data we add a signature (e.g. for tokens). A
signature is created using an asymmetric signing key. That way the private key
never has to be exposed.

## Encryption Decisions

### Data at rest

Secret values which might need to be sent to other systems (e.g. IdP secrets,
API keys, tokens, etc.) cannot be stored as a simple hash. But we cannot store
them in plain text. For these values we use encryption. More specifically, we use
AES-GCM to encrypt these values.

### Third party secrets

We will need to store secrets required for communication with other parties.
E.g.: IdP secrets, API keys, etc. These keys should be stored encrypted in the
database. For that encryption, also AES-GCM will be used.

### Tokens

As an identity platform, we will need to issue tokens. These tokens can be in
multiple formats according to multiple protocols (OIDC, SAML, etc.). Unless a
protocol states otherwise, we use a [JWE](https://datatracker.ietf.org/doc/html/rfc7516)
as an authorization token where the client does not need to introspect the claims.
When the client does need to introspect the token (without extra network calls),
we default to a [JWT](https://datatracker.ietf.org/doc/html/rfc7519).

Authorization tokens should always be signed using an asymmetric key. For more
info on keys, see [the signing/encryption keys decision](#signingencryption-keys).

### Signing/encryption keys

The application uses different keys for different use-cases:

```mermaid
graph TD
%% Nodes
    MasterKey["RSA Master Key"]
    KEK["AES Project Key Encryption Key (KEK)"]
    TokenSigningKeys["Token Signing Keys"]
    SecretEncryptionKey["AES Secret Encryption Key"]
    TokenEncryptionKey["AES Token Encryption Key"]
    CookieEncryptionKey["AES Cookie Encryption Key"]
    ThirdPartySecrets["Third-Party Secrets"]
    OpaqueTokens["Opaque tokens"]
    Cookies["Flow cookies"]
%% Hierarchy Relationships
    MasterKey --> KEK
    KEK --> TokenSigningKeys
    KEK --> SecretEncryptionKey
    KEK --> TokenEncryptionKey
    KEK --> CookieEncryptionKey
    SecretEncryptionKey --> ThirdPartySecrets
    TokenEncryptionKey --> OpaqueTokens
    CookieEncryptionKey --> Cookies
 ```

Every project gets one key encryption key (KEK), wrapped by the master key. The
KEK encrypts nothing but the project's other keys; each of those has a single
purpose and encrypts data directly. A purpose-scoped key can therefore be
rotated without re-encrypting everything else the project stores.

#### Storage

We need to store encryption/signing keys for multiple use-cases in the database.
Storing these keys falls under the [data at rest decision](#data-at-rest)
(envelope encryption).

#### Scope

To ensure isolation we create a separate set of keys per project. By creating
key sets per project, it is cryptographically not possible for one customer to
read encrypted data of another customer. Since all signing keys are asymmetric,
data encrypted/signed with previous keys can still be verified. The private keys
never leave our system. The public signing keys can be requested in the form of
a [JWK](https://datatracker.ietf.org/doc/html/rfc7517).

#### Rotation

All signing keys will be periodically and automatically rotated. This happens by
default every 30 days. This is also configurable. This is done so that it is
possible to isolate possibly forged tokens within a window of time in case of a
breach.

Rotating the master key is something which has to be managed by an outside
process since the key should also be provided from outside the application. The
rotation process can be managed by a tool like cert-manager in k8s.

#### Master key

Since encryption keys need to be stored in the database and storage needs to be
according to the [data at rest decision](#data-at-rest), they also need to be
encrypted. To do this, a master-key has to be provided by config. This can be
done via a cli argument or a config parameter/environment variable. If no
master-key is provided, the application will create one and write it to the
host's file system. This auto-creation is mainly for testing and developing the
system. A production system should specify its own master-key.

To ensure master-key rotation:

- A master-key needs to be asymmetric
- It is possible to specify multiple master-keys with one marked for encryption.
  The other keys will be used for decryption only.

For easy integration with systems like k8s, the master key can be provided as an
x.509 certificate with private and public key inside. That way a cert-manager
could handle rotation.

## NIST

A growing number of customers require NIST compliance. We should provide this
out of the box. A customer will be able to enable NIST compliance per project.
This can be done either in the configuration file/environment variables to
set it up right out of the gate or using the console ui or the api when a
customer wants to set it up later.

By enabling NIST compliance, certain features and policies will be enabled or
disabled by default. For example, password hashing and encryption primitives will
be restricted to those allowed by the selected compliance profile (e.g., FIPS-approved
algorithms); the exact rules will be validated at implementation time.
