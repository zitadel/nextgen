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
This so that a tenant can have specific requirements like FIPS.

By default, we should use [`argon2id`](https://datatracker.ietf.org/doc/html/rfc9106)
for password/secret hashing.

#### Tokens

(Generated) Tokens should never be stored in the database. If a field is
required for revocation, this can be achieved by storing the token id (E.g.:
`jti`) or the signature of the token. Since the token id itself is not a secret,
it does not need to be hashed. Since the signature of a token is already a
cryptographic output, so additional hashing is not required.

### Signatures

To ensure integrity of some data we add a signature (e.g. for tokens). A
signature is created using an asymmetric signing key. That way the private key
never has to be exposed.

## Encryption Decisions

### Data at rest

Secret values which might need to be sent to other systems (E.g.: IdP secrets,
API keys, tokens, etc.) cannot be stored as a simple hash. But we can not store
them in plain text. For these values we use encryption. More specific, we use
AES-GCM to encrypt these values.

### Third party secrets

We will need to store secrets required for communication with other parties.
E.g.: IdP secrets, API keys, etc. These keys should be stored encrypted in the
database. For that encryption, also AES-GCM will be used.

### Tokens

As an identity platform, we will need to issue tokens. These tokens can be in
multiple formats according to multiple protocols (OIDC, SAML, etc.). Unless a
protocol states otherwise, we use an [JWE](https://datatracker.ietf.org/doc/html/rfc7516)
as authorization token where the client does not need to introspect the claims.
When the client does need to introspect the token (without extra network calls),
we default to a [JWT](https://datatracker.ietf.org/doc/html/rfc7519).

Authorization token should always be signed using an asymmetric key. For more
info on keys, see [the signing keys decision](#signing-keys).

### Signing/encryption keys

The application uses different keys for different use-cases:

```mermaid
graph TD
%% Nodes
    MasterKey["Master Key (KEK)"]
    DEK["Data Encryption Key (DEK)"]
    TokenSigningKeys["Token Signing Keys"]
    ThirdPartySecrets["Third-Party Secrets"]
    ExternalTokenEncryptionKey["Encryption key for<br/>encrypting opaque tokens"]
%% Hierarchy Relationships
    MasterKey --> DEK
    DEK --> TokenSigningKeys
    DEK --> ThirdPartySecrets
    DEK --> ExternalTokenEncryptionKey
 ```

#### Storage

We need to store encryption/signing keys for multiple use-cases in the database.
Storing these keys falls under the [data at rest decision](#data-at-rest) 
(envelope encryption). 

#### Scope

To ensure isolation we create a separate set of keys per project. Such a set may 
contain, but is not limited to:

By creating key sets per project, they can be rotated in case of a leak or
incident. Since all keys are asymmetric, data encrytped/signed with previous
keys can still be decrypted/verified. The private keys never leave our system.
The public signing keys can be requested in the form of a [JWK](https://datatracker.ietf.org/doc/html/rfc7517).

#### Auto-rotation

All generated keys will be periodically and automatically rotated. This happens 
by default each 30 days. But this is also configurable.

Rotating the master key is something which has to be managed by an outside 
process since the key should also be provided from outside the application.

#### Master key

Since encryption keys need to be stored in the database and storage needs to be
according to the [data at rest decision](#data-at-rest), they also need to be
encrypted. To do this, a master-key has to be provided by config. This can be
done via a cli argument or a config parameter/environment variable. If
no master-key is provided, the application will create one and write it to the
host's file system. This auto-creation is mainly for testing and developing the
system. A production system should specify its own master-key.

To ensure master-key rotation:

- A master-key needs to be asymmetric like all other encryption keys
- It is possible to specify multiple master-keys with one marked for encryption.
  The other keys will be used for decryption only.

For easy integration with systems like k8s, the master key can be provided as an
x.509 certificate with private and public key inside. That way a cert-manager 
could handle rotation.

#### Public keys are not "public"

**Important: public key cannot be public**: In normal cases of a private/public
key pair, the private key should be treated as a secret and the public key can
be shared. This is not the case for the master-keys of the system since it
would defeat the purpose of the key. Once the private or the public key is 
leaked it should immediately be rotated and a data migration should happen. The
process for emergency key rotation is out of scope for this ADR though.

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
