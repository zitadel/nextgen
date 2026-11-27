# ADR 092: Authentication Requirements

> **Status:** Draft  
> **Date:** 2026-11-17  
> **Context:** [#3166](https://github.com/zitadel/nextgen/issues/3166) and
> [#3202](https://github.com/zitadel/nextgen/issues/3202)  
> **Related:** [ADR 010](010-session-auth-attempt-check-model.md),
> [ADR 037](037-token-lifecycle.md),
> [ADR 038](038-user-credential-migration-and-recovery.md),
> [ADR 053](053-cross-project-principals.md),
> [ADR 066](066-operation-policies.md),
> [ADR 072](072-session-idle-and-absolute-lifetime.md),
> [ADR 078](078-abuse-prevention-in-layers.md),
> [ADR 081](081-customer-hosted-login-and-oidc-provider.md),
> [ADR 085](085-which-release-serves-a-request.md)

This ADR proposes how a customer states which authentication a project requires
from its users, and how the server enforces it.

## Context

Customers do not all need the same authentication from their users. They might
need multi-factor authentication (MFA) from every user of a project, only from
the administrators of their app, or let their users sign in with a password and
ask them to verify again before a sensitive action, such as updating payment
details.

All of these cases require reading the requirement, comparing it against the
user's completed checks, and prompting only for the checks that are missing.
This ADR proposes one unified model covering project-wide MFA and stricter or
fresh authentication requested by an app (such as for administrators or
sensitive actions). Policies scoped to subsets of users (e.g., a team or role)
are out of scope; [#3166](https://github.com/zitadel/nextgen/issues/3166) defers
finer applicability to a later slice.

## Terminology

| Term                       | Definition                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Method**                 | A way to authenticate (e.g., password, passkey, TOTP code).                                                                                                                                                                                                                                             |
| **Enroll**                 | Adding a method to a user's account for future authentication.                                                                                                                                                                                                                                          |
| **Factor type**            | What a method proves: something the user knows, has, or is.                                                                                                                                                                                                                                             |
| **User verification (UV)** | Authenticator verification via PIN or biometric ([WebAuthn](https://www.w3.org/TR/webauthn-3/#user-verification)), reported in the assertion's UV flag.                                                                                                                                                 |
| **Policy**                 | A project's operation policy holding the settings in this ADR ([ADR 066](066-operation-policies.md)), deployed with a release.                                                                                                                                                                          |
| **Check**                  | A single completed verification in a session: a completed method, external sign-in, or recovery check.                                                                                                                                                                                                  |
| **Proof**                  | The checks completed in a session, each with its completion timestamp.                                                                                                                                                                                                                                  |
| **Requirement**            | What the proof must satisfy, defined by policy and optionally tightened by a request.                                                                                                                                                                                                                   |
| **Attempt**                | A series of challenges to complete checks. Completing an attempt creates a session or appends checks to an existing one ([ADR 010](010-session-auth-attempt-check-model.md)).                                                                                                                           |
| **App**                    | The customer's application, including any backend API that consumes tokens. An app that hosts the login calls the session API directly ([ADR 081](081-customer-hosted-login-and-oidc-provider.md#1-the-customers-app-hosts-the-login)), while an OIDC/OAuth client app uses the authorization endpoint. |

## Proposal

### 1. Model

The server compares the active requirement against the proof in the user's
session. If the proof satisfies the requirement, the user proceeds without a
prompt. Otherwise, the server prompts only for the missing checks.

A requirement has four properties. The policy sets the baseline for every
session in the project; a request can tighten any property for a single action
but never weaken it, so the stricter value of each property applies.

The table shows the policy setting and the request parameter for each property.

| Property            | What the proof has to show                                                  | Setting in the policy  | Parameter in a request |
| ------------------- | --------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Strength            | At least two different factor types                                         | `mfa`                  | `acr_values`           |
| Phishing resistance | A method that a fake login page cannot capture and reuse                    | `phishing_resistant`   | `acr_values`           |
| Age                 | Every check that counts toward the requirement is within a limit in seconds | `max_age_seconds`      | `max_age`              |
| Recent check        | A qualifying check is within a limit in seconds                             | `recent_check_seconds` | `recent_check`         |

The `acr_values` parameter takes the following values. Each has the same meaning
in every project:

| Value                     | The proof shows                                                                                  | Defined by                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `urn:zitadel:loa:2fa:any` | At least two different factor types                                                              | This ADR                                                                                            |
| `urn:zitadel:loa:1fa:phr` | A phishing-resistant method                                                                      | This ADR                                                                                            |
| `urn:zitadel:loa:2fa:phr` | At least two different factor types and a phishing-resistant method                              | This ADR                                                                                            |
| `phr`                     | The same as `urn:zitadel:loa:1fa:phr`. A request that sends `phr` gets `phr` in the `acr` claim. | [OpenID Connect EAP ACR Values §2](https://openid.net/specs/openid-connect-eap-acr-values-1_0.html) |

- **Combining strength and phishing resistance:** A request requiring both sends
  `urn:zitadel:loa:2fa:phr`. Sending the other two values as separate
  space-delimited values does not require both, because OpenID Connect treats
  multiple `acr_values` as an ordered preference list and returns only one in
  the token's `acr` claim
  ([OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)).
- **Age applies to every required check:** Under `mfa` with a 5-minute limit, a
  2-hour-old password verification must be repeated even if the TOTP code is 1 minute old.
- **A recent check preserves older checks:** Only one check needs to be within
  the limit, and it must be a qualifying check. Under `mfa` with a 5-minute
  `recent_check`, a user whose password and TOTP code are both 2 hours old only
  needs to enter a new TOTP code; the 2-hour-old password still counts.

Which check qualifies depends on the requirement in force. The table names a
requirement by its policy setting, whether the policy or a request sets it:

| Requirement in force                   | Qualifying check                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Neither `mfa` nor `phishing_resistant` | Any method that completes a sign-in, including a password or an external sign-in                                             |
| `mfa`                                  | Any method except a password; a passkey with user verification, or without it when the checks of the same attempt meet `mfa` |
| `phishing_resistant`                   | A passkey                                                                                                                    |
| `mfa` and `phishing_resistant`         | A passkey with user verification, or without it when the checks of the same attempt meet `mfa`                               |

- A recovery check never qualifies
- An external sign-in:
  - never qualifies when neither `mfa` nor `phishing_resistant` applies
  - never qualifies under `phishing_resistant`
  - qualifies under `mfa` when its connection is trusted and `amr` contains
    `mfa`
- For a passkey under `mfa`, the server sets `user_verification` to
  `preferred` and reads the UV flag of the response. With the flag set, the
  passkey qualifies. Without it, the passkey qualifies only when the checks
  completed in the same attempt meet `mfa` together, such as a password and the
  passkey. The server does not set `required` here, except in the case in
  [§2](#2-policy-configuration). With `required`, a browser does not send the
  request to an authenticator that has no PIN or biometric, such as an older
  security key, so no response reaches the server, and that user cannot complete
  the check, even together with a password.

#### Evaluation Triggers and Timing

The following table shows the situations in which the server makes the
comparison and the requirement that it compares in each situation.

| Situation             | Trigger                                                                | Requirement evaluated                                                                   |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Sign-in**           | User initiates sign-in.                                                | Policy ([§4.1](#41-sign-in-and-session-reuse))                                          |
| **Session reuse**     | Signed-in user returns to the app or opens another app in the project. | Policy ([§4.1](#41-sign-in-and-session-reuse))                                          |
| **Sensitive action**  | App sends `acr_values`, `max_age`, `recent_check`, or any combination. | Policy + Request ([§4.2](#42-step-up-and-reauthentication-sensitive-actions))           |
| **Method management** | User's session requests a change to their own methods.                 | Policy + fresh checks in the same attempt ([§4.6](#46-changing-authentication-methods)) |

- **When the server evaluates:** At attempt creation, to find the missing
  checks, after each completed check, to update the list, and at completion, to
  enforce the requirement.
- **Age at completion:** A check's age is measured when the attempt completes.
  Because an attempt can stay open for 15 minutes, a session check that was
  within the limit when the attempt was created may exceed it before completion
  and need to be repeated. This applies to the max age limit and recent check
  limits.
- **Release pinning:** An attempt stays pinned to the release under which it was
  created; both evaluations use that release's policy even if a newer release
  deploys in between ([#3202](https://github.com/zitadel/nextgen/issues/3202)).

#### Supported Features

The table shows how the model handles each feature from
[#3166](https://github.com/zitadel/nextgen/issues/3166). What it does not cover
yet is listed under [Open questions](#open-questions).

| Feature                | How the model handles it                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mandatory MFA**      | Policy sets `mfa`; every sign-in is evaluated against it.                                                                                  |
| **Step-up**            | Proof lacks a factor type or phishing-resistant method; apps trigger it via `acr_values` ([§1](#1-model)).                                 |
| **Reauthentication**   | Proof is too old; the user repeats any checks exceeding the age limit, or completes a single fresh check when only a recent check applies. |
| **Conditional MFA**    | App evaluates custom conditions (e.g., a stricter workspace) and sends `acr_values` when they apply.                                       |
| **Adaptive MFA**       | The app or an external service assesses risk. The app sends `acr_values` to step up, or blocks the attempt on rejection.                   |
| **Ongoing evaluation** | Server re-evaluates policy on every session reuse; apps send a new request when circumstances change.                                      |

### 2. Policy Configuration

A requirement says what the proof must show, such as two different factor types.
It does not list methods. The methods a user can use come from the user schema
(`x-auth-methods`), so enabling a new method requires no policy change.
Enrollment and sign-in read from the same schema, so they agree on which methods
a user can use. Enrolling a method does not remove an existing sign-in option,
because the server compares the proof with the requirement and not with a list
of methods ([#3166](https://github.com/zitadel/nextgen/issues/3166)).

Each method proves a fixed factor type.

- **Knowledge:** Password.
- **Possession:** TOTP code, SMS code, passkey.
- **Passkey with UV:** Counts as **two** factor types only when the UV flag is
  set: possession, and knowledge (a PIN) or inherence (a biometric). When the
  user schema enables no method of another factor type, such as a password, the
  server sets `user_verification` to `required`, because a passkey without user
  verification cannot meet `mfa` for any user of that schema.
- **No same-type stacking:** Two possession methods (e.g., TOTP + SMS) count as
  one factor type and do not satisfy `mfa`
  ([#3166](https://github.com/zitadel/nextgen/issues/3166)).
- **Non-factor checks:** Recovery checks and external sign-ins count as no
  factor type, except as defined in [§4.4](#44-account-recovery) and
  [§4.5](#45-external-sign-in).

The requirement is configured as an operation policy
([ADR 066](066-operation-policies.md)) for the operation `auth.factors.verify`
and deployed with a release.

```json
{
  "$schema": "../meta/policy.json",
  "operation": "auth.factors.verify",
  "config": {
    "mfa": true,
    "phishing_resistant": true,
    "max_age_seconds": 43200,
    "recent_check_seconds": 3600,
    "first_enrollment": "admin"
  }
}
```

The table shows the meaning of each setting.

| Setting                | Type    | Meaning                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mfa`                  | boolean | Proof must contain at least two different factor types.                                                                                                                                                                                                                                        |
| `phishing_resistant`   | boolean | Proof must include a method a fake login page cannot capture and replay (passkeys qualify; password + TOTP does not).                                                                                                                                                                          |
| `max_age_seconds`      | integer | Maximum age for every check needed to satisfy the requirement. The server does not compare the proof when a token is refreshed.                                                                                                                                                                |
| `recent_check_seconds` | integer | Maximum age of the newest qualifying check ([§1](#1-model)). Older checks remain valid (up to `max_age_seconds`, if set). Must be smaller than `max_age_seconds` when both are set. Like `max_age_seconds`, it is compared at sign-in and at session reuse, and not when a token is refreshed. |
| `first_enrollment`     | enum    | Verification required before enrolling a mandated method ([§4.3](#43-first-enrollment)).                                                                                                                                                                                                       |

The following rules apply to the settings:

1. **No server defaults:** Omitted settings are not evaluated
   ([ADR 066](066-operation-policies.md#no-server-defaults)).
2. **Release-bound with built-in minimum:** Requests use the serving release's
   policy; if none exists, no policy applies
   ([ADR 066](066-operation-policies.md#amendment-2026-10-30-a-policy-comes-only-from-a-release),
   [ADR 085](085-which-release-serves-a-request.md)). Regardless, the server
   enforces a built-in minimum of one completed method, and an identifier alone
   never completes an attempt (`IsCompleted` in
   `internal/domain/auth_attempt.go`).
3. **Project-wide scope:** Applies to all users and apps in the release until
   [ADR 066's audience mechanism](066-operation-policies.md#applicability) is
   decided.
4. **Independent flags:** `mfa` and `phishing_resistant` do not imply each
   other. A passkey without user verification is phishing-resistant but proves
   only one factor type, so a policy that requires MFA with a phishing-resistant
   method needs both settings.
5. **Minimal proof subset:** Not every session check is needed. A UV passkey
   satisfies `mfa` alone, making an older password check in the same session
   irrelevant.
6. **In-attempt freshness:** Any check completed during the current attempt
   counts as within that attempt's age limit and recent check, except an
   external sign-in, whose time comes from the provider
   ([§4.5](#45-external-sign-in)). This enables `max_age=0`, `prompt=login` and
   `recent_check=0`
   ([OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest);
   see [Risks](#risks)).

The policy is invalid and rejected by the release in the following cases:

| Case                                                                                                                                             | Reason                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A user schema that enables a sign-in method cannot satisfy the policy, such as password-only under `mfa` ([§4.1](#41-sign-in-and-session-reuse)) | No user of that schema could sign in                                                         |
| `mfa` or `phishing_resistant` is set without `first_enrollment` ([§4.3](#43-first-enrollment))                                                   | The server has no default value                                                              |
| `recent_check_seconds` is not smaller than `max_age_seconds`                                                                                     | The recent check would have no effect, and swapped values make every user repeat every check |

### 3. Determining `required_factors`

An attempt returns `required_factors`, the list of methods that the user can
complete next. After each completed method, the server re-evaluates and returns
an updated list until the attempt is `completed`. `required_factors` already
exists in the session API, described as the methods the policy requires to
complete the attempt
(`api/openapi/endpoints/auth_attempts/auth-attempt-response.yaml`). The server
returns an empty list on every attempt today (`IsCompleted` in
`internal/domain/auth_attempt.go`), so the new meaning does not break a client.

What the list holds depends on whether the user has completed a check:

- **Before the first check:** Schema-enabled methods that can initiate sign-in
  (password, passkey, external sign-in). In flows, the schema comes from the
  flow definition, keeping the list identical for every identifier.
- **After a check (or for signed-in users):** Enrolled methods the user still
  needs to complete, depending on what the proof is missing:
  - **Missing factor type or phishing-resistant method:** Included if enrolled;
    otherwise, the user must enroll a method ([§4.3](#43-first-enrollment)).
  - **Unmet age limit or recent check:** Included if enrolled so the user can
    repeat it; otherwise, the server refuses the attempt
    ([§4.2](#42-step-up-and-reauthentication-sensitive-actions)). This only
    affects users relying solely on an external provider that omits `auth_time`
    ([§4.5](#45-external-sign-in)).

#### Anti-Enumeration Rules

A caller with only an email address must not be able to infer an account's
enrolled methods:

- **Uniform pre-check responses:** Identical for every user. Passkey challenges
  omit credential IDs; once a user is identified, only that user's passkeys are
  accepted. After a completed check, a passkey challenge lists the user's
  credential IDs. A passkey that is not discoverable, such as a security key
  registered as a second factor in v4, responds only to a challenge that
  includes its credential ID, so it works once another check, such as the
  password check, is completed.
- **No standalone codes:** TOTP codes, SMS codes, and recovery codes are
  accepted only after another check (e.g., password), with appropriate
  rate-limits for failed checks per user and method as defined in
  [ADR 078](078-abuse-prevention-in-layers.md#3-layer-2-guards-are-built-in-and-always-on).
- **Uniform failures:** Checking an unenrolled method (e.g., password or TOTP)
  returns the same error and takes the constant time as an incorrect credential.

### 4. How Requirements Apply

#### 4.1 Sign-In and Session Reuse

At sign-in, the server evaluates proof against the policy and requires missing
methods before completion:

1. **Universal enforcement:** Applies identically to flows, session API
   attempts, authorization requests, and custom login pages built on them.
2. **Release validation:** A release is rejected if any user schema cannot
   satisfy its policy (e.g., password-only under `mfa`), identifying the schema
   in the error. A schema that enables no sign-in method is not validated,
   because its users do not sign in. For example, a machine schema that
   authenticates by client credentials does not block an `mfa` policy for human
   users.
3. **Runtime safeguard:** Sign-in never completes without sufficient proof, even
   if release validation missed an issue
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
4. **Forced enrollment:** Users who cannot satisfy `mfa` or `phishing_resistant`
   with enrolled methods must enroll before sign-in finishes
   ([§4.3](#43-first-enrollment)).
5. **Project administrators:** Customer project admins are platform project
   users ([ADR 053](053-cross-project-principals.md)), so their sign-ins follow
   the operator-deployed platform policy, not the customer's policy. A customer
   can still require MFA for the administrators of its own app, because that app
   sends `acr_values`
   ([§4.2](#42-step-up-and-reauthentication-sensitive-actions)).

**Session reuse and policy updates:**

- Returning to an app or opening another app in the project re-evaluates the
  session against the serving release's policy
  ([#3202](https://github.com/zitadel/nextgen/issues/3202)). Missing checks, or
  checks older than `max_age_seconds` or `recent_check_seconds`, are completed
  in the same session without signing the user out.
- A proof is valid for as long as its session exists. When the session expires,
  the proof ends with it, and the user completes every required check at the
  next sign-in. Extending a session does not refresh a check, because a check
  keeps its `verified_at`
  ([ADR 072 §5](072-session-idle-and-absolute-lifetime.md#5-freshness-stays-with-the-factors)).
  A new check in the session is added to the proof and restarts the session's
  lifetime. Without `max_age_seconds`, the session's lifetime is therefore the
  only limit on the age of a proof.
- A stricter policy does not end existing sessions. A session is evaluated only
  when its user returns to the app or opens another app, so a user who stays in
  one app keeps access until the session expires. A token refresh is not
  evaluated either, so neither `max_age_seconds` nor `recent_check_seconds`
  limits how long an app that refreshes its tokens keeps access
  ([Open question 3](#open-questions)).
- With the session API, the server evaluates an existing session when the app
  that hosts the login starts a new attempt for it (`POST /auth_attempts` with
  `session_id`). Reading
  the session (`getSession`) does not evaluate it. After a stricter policy is
  deployed, a session that satisfied the old policy therefore keeps access until
  the app starts a new attempt for it ([Open question 3](#open-questions)).

#### 4.2 Step-Up and Reauthentication (Sensitive Actions)

Because the server does not know which app actions are sensitive, the app sends
`acr_values`, `max_age`, `recent_check`, or any combination via:

- **Session API:** `acr_values`, `max_age`, and `recent_check` fields on
  `POST /auth_attempts` (alongside `session_id` and `session_token`).
- **OIDC / OAuth:** `acr_values` and `max_age` on the authorization request
  ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)), plus `recent_check` as
  an additional parameter on the same request.

The following rules apply to the values:

- The values of `acr_values` are listed in [§1](#1-model) and have identical
  meaning across all projects.
- Multiple `acr_values` are alternatives in preference order
  ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)); the server selects the
  first value the user can meet with enrolled methods (e.g., for
  `urn:zitadel:loa:1fa:phr urn:zitadel:loa:2fa:any`, a user without a passkey
  falls back to the second value).
- `acr_values` and `max_age` can be combined. `max_age=0` and `prompt=login` are
  equivalent
  ([OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)).
  With either, the user completes the required checks again in the same session.
- `recent_check` is a limit in seconds defined by this ADR, since OpenID Connect
  has no parameter for a single recent check. It can be combined with
  `acr_values` and `max_age`, with each enforced independently. If the newest
  qualifying check is older than the limit, the user completes one fresh check
  while older checks remain in the proof. When `mfa` is not required, a password
  alone satisfies `recent_check`; to require a recent second factor (such as
  TOTP), the app must send
  `acr_values=urn:zitadel:loa:2fa:any` alongside `recent_check`.

**Refused requests:** The server refuses a request if:

1. `acr_values` contains no supported value.
2. The user schema cannot satisfy any requested value (refused only **after** a
   completed check).
3. The user must enroll a method to satisfy any value, but `first_enrollment` is
   unset or `admin` (refused only **after** a completed check to prevent
   enumeration; under `first_enrollment: none`, the user enrolls in-flow).
4. No enrolled method can satisfy the requested age limit or recent check
   (refused only **after** a completed check). This only affects users relying
   solely on an external provider that omits `auth_time`; they cannot enroll a
   method themselves either ([§4.5](#45-external-sign-in), rule 5), so they need
   admin-authorized enrollment.
5. `recent_check` on an authorization request is negative, not an integer, or
   sent more than once. The error is `invalid_request`
   ([RFC 6749 §4.1.2.1](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2.1)).

**Error codes:** `unmet_authentication_requirements` for OIDC/OAuth
([spec](https://openid.net/specs/openid-connect-unmet-authentication-requirements-1_0.html))
and `att.unmet_authentication_requirements` for the session API. OpenID Connect
Core allows a server to issue a token with a weaker `acr`. The server refuses
instead, as [RFC 9470 §5](https://www.rfc-editor.org/rfc/rfc9470#section-5)
recommends for access tokens. With `prompt=none`, insufficient proof returns
`login_required`
([OpenID Connect Core §3.1.2.6](https://openid.net/specs/openid-connect-core-1_0.html#AuthError)).

**Reporting the result:**

- **OIDC / OAuth tokens:** Access tokens (and ID tokens for OIDC) include `acr`,
  `amr`, `auth_time`, and `recent_check_at`. A token refresh does not change
  their values, because the user does not authenticate again.
  [RFC 9470 §6.1](https://www.rfc-editor.org/rfc/rfc9470#section-6.1) states
  this for an access token, and
  [OpenID Connect Core §12.2](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse)
  requires it for `auth_time` in an ID token.
  - `acr`: First value from `acr_values` satisfied by the proof (omitted if
    `acr_values` was not requested).
  - `amr`: The methods of the checks that `auth_time` is computed from, with the
    values in the table. An external sign-in and a recovery check have no value,
    and the claim is omitted when no check has one.

    | Value | Check                                                        | Defined by                                                                                          |
    | ----- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
    | `pwd` | Password                                                     | [RFC 8176 §2](https://www.rfc-editor.org/rfc/rfc8176#section-2)                                     |
    | `otp` | TOTP code                                                    | [RFC 8176 §2](https://www.rfc-editor.org/rfc/rfc8176#section-2)                                     |
    | `sms` | SMS code                                                     | [RFC 8176 §2](https://www.rfc-editor.org/rfc/rfc8176#section-2)                                     |
    | `pop` | Passkey                                                      | [OpenID Connect EAP ACR Values §3](https://openid.net/specs/openid-connect-eap-acr-values-1_0.html) |
    | `mfa` | Added when the listed checks show two different factor types | [RFC 8176 §2](https://www.rfc-editor.org/rfc/rfc8176#section-2)                                     |

  - `auth_time`: The time from which the user's checks satisfy the requirement.
    A combination of checks is as old as its oldest check, and if several
    combinations satisfy the requirement, the server reports the most recent
    one. For example, under `mfa`, a 2-hour-old password with a 1-minute-old TOTP
    code is 2 hours old, while a 5-minute-old UV passkey satisfies `mfa` alone,
    so `auth_time` is 5 minutes ago. Without a policy or `acr_values`,
    `auth_time` is the time of the newest check ([§2](#2-policy-configuration)).
  - `recent_check_at`: Time of the newest qualifying check ([§1](#1-model)) for
    the policy and the returned `acr`, in epoch seconds like `auth_time`.
    Defined by this ADR, it matches that check's `verified_at` in the session
    API and is included even when `recent_check` was not requested. In the
    example above, `recent_check_at` is 1 minute ago.

  `auth_time` or `recent_check_at` is omitted when its check is an external
  sign-in without
  `auth_time` ([§4.5](#45-external-sign-in)).

- **Mandatory app validation:** The app/API must verify `acr`, compare
  `auth_time` against its own `max_age`, and compare `recent_check_at` against
  its own `recent_check` before allowing the action. The app checks the claims
  in the ID token per
  [OpenID Connect Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation),
  and the API checks the claims in the access token per
  [RFC 9470 §6](https://www.rfc-editor.org/rfc/rfc9470#section-6). A missing
  claim counts as not satisfied. Completing a recent check does not change
  `auth_time`, so the app compares the two limits separately: a token from a
  request with `recent_check=0` in place of `max_age=0` still carries the old
  `auth_time`, and the app rejects it. If insufficient, the API returns
  `insufficient_user_authentication` so the app initiates a new request
  ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)).
- **Session API:** Returns `factors` (each verified check with `verified_at`,
  plus `user_verified` for passkeys) and `assurance_levels` (which `acr`
  values of [§1](#1-model) are met; the session does not report the
  age of the proof, see [Open question 8](#open-questions)).
- **User-facing message:** The login page or the app tells the user why a check
  is needed or why it cannot be completed. The server returns `required_factors`
  for the first case and an error code for the second.

#### 4.3 First Enrollment

Users who cannot meet `mfa` or `phishing_resistant` with enrolled methods (e.g.,
anyone without a passkey under `phishing_resistant`) must enroll before sign-in
completes. Enrollment is protected against account takeover via stolen
credentials through the following rules:

1. Before enrolling a method, existing users must complete at least one check in
   the same attempt, and the checks must meet the policy. A user who has
   enrolled methods of both factor types, such as a password and TOTP, completes
   a check of each type, even when the policy does not require `mfa`. Older
   session checks do not count.
   - **Adding a passkey when the user has one:** The user must verify with a
     passkey using user verification; a password and an SMS code are not enough
     ([#3202](https://github.com/zitadel/nextgen/issues/3202)). A user whose
     passkey has no user verification needs admin-authorized enrollment for it.
   - **Lost passkey:** The user follows [§4.4](#44-account-recovery) (see
     [Risks](#risks)).
   - **After enrollment:** The new method counts toward the requirement in the
     same attempt, and a passkey counts as two factor types only if its
     registration has the UV flag set.
2. No prior check is required when enrolling during account creation.
3. Users with no method and no external sign-in cannot self-enroll under any
   policy (or without one). An administrator issues a single-use, time-limited,
   user-bound authorization, and the user enrolls the method themselves
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)). When a user who
   has other methods gets an authorization ([§4.4](#44-account-recovery),
   `first_enrollment: admin`), it stands in only for the checks of rule 1 that
   the user cannot complete, so the user still completes the others. The server
   returns the authorization in the API response and the administrator delivers
   it to the user, as `createInvitation` does for its link. Which permission
   issues it is open ([Open question 13](#open-questions)).

**The `first_enrollment` policy setting** governs users who only have a password
or external sign-in:

| Value   | Requirement before enrollment                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| `none`  | No extra step. The customer accepts the risk that a holder of the user's sole credential can enroll a method. |
| `admin` | No self-enrollment. The customer verifies the user out-of-band and uses admin-authorized enrollment.          |

**Rules:**

1. A release setting `mfa` or `phishing_resistant` without `first_enrollment` is
   rejected, because the server has no default value to use instead.
2. Also applies when `acr_values` triggers enrollment (if unset, the request is
   refused per [§4.2](#42-step-up-and-reauthentication-sensitive-actions)).
3. Does not apply during registration.
4. The policy template lists only currently supported values; future options
   (e.g., verified email/phone codes) can be added without breaking deployed
   policies ([ADR 066](066-operation-policies.md#instance)).

#### 4.4 Account Recovery

When a user loses a method, they can complete a **recovery check** via a
recovery route such as a recovery code
([ADR 038](038-user-credential-migration-and-recovery.md#4-account-recovery))
and the following rules apply:

1. A recovery check does not count as a factor type (password + recovery code
   does not satisfy `mfa`), which prevents the use of a recovery code as a
   standing second factor
   ([#3166](https://github.com/zitadel/nextgen/issues/3166)).
2. A recovery check substitutes for the lost method's check, allowing the user
   to enroll a replacement in the same attempt. Together with the user's other
   checks, it must satisfy the policy and cover both factor types if the user
   has both enrolled. For example, a user who loses both a passkey and TOTP can
   replace the passkey using their password and a recovery check, without
   needing a TOTP code ([Open question 14](#open-questions)).
3. A recovery check alone does not permit the enrollment. A user who cannot
   verify another method requires admin-authorized enrollment
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
4. Enrolling the replacement counts as a check of that method, allowing sign-in
   to complete (under `phishing_resistant`, the replacement must be a passkey)
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
5. A user who cannot complete a recovery check requires admin-authorized
   enrollment ([#3202](https://github.com/zitadel/nextgen/issues/3202)).

#### 4.5 External Sign-In

A sign-in through an external identity provider is recorded as one check because
the provider decides which methods the user completes. It is evaluated via two
values (supplied as OIDC ID token claims):

- `amr`: Methods completed at the provider, e.g., `pwd`, `otp`, `mfa`
  ([RFC 8176](https://www.rfc-editor.org/rfc/rfc8176)).
- `auth_time`: Authentication timestamp at the provider
  ([OpenID Connect Core §2](https://openid.net/specs/openid-connect-core-1_0.html#IDToken)).

**Rules:**

1. An external sign-in does not count as a factor type (external sign-in + TOTP
   does not satisfy `mfa`)
   ([#3166](https://github.com/zitadel/nextgen/issues/3166)).
2. Connections marked trusted in the connection document satisfy `mfa` if `amr`
   contains `mfa`; otherwise they count as no factor type
   ([#3166](https://github.com/zitadel/nextgen/issues/3166)).
3. Even trusted connections cannot satisfy `phishing_resistant` because `amr`
   has no phishing-resistant value
   ([RFC 8176](https://www.rfc-editor.org/rfc/rfc8176)); the user must complete
   a passkey in Zitadel.
4. The age of this check is based on the provider's `auth_time` and not on the
   time the user returned, because a provider can return a user from an older
   session without a prompt. When an age limit applies, the server forwards
   `max_age` to the provider, requiring it to return `auth_time`
   ([OpenID Connect Core §2](https://openid.net/specs/openid-connect-core-1_0.html#IDToken)).
   This applies to both the age limit and the recent check. Under a trusted
   connection, an external sign-in is a single check, so satisfying a recent
   check requires signing in again at the provider. A Zitadel method that
   qualifies ([§1](#1-model)) also satisfies it, such as a TOTP code or a
   passkey with user verification, and the earlier external sign-in still counts
   toward `mfa`. The server uses the earlier of the provider's `auth_time` and
   the time the user returned, so a future-dated value cannot extend a limit.
   Without `auth_time`, the check has no time.
5. For an enrollment or a method change, the server sends `max_age=0`, so a
   provider that supports it asks the user to authenticate again. The external
   sign-in counts only when the returned `auth_time` is after the attempt
   started (rule 6). Otherwise the user completes another method or needs
   admin-authorized enrollment. This applies also under
   `first_enrollment: none`.
6. An external sign-in without `auth_time`, or with an `auth_time` that is older
   than the limit, does not meet an age limit or a recent check, so the user
   completes a method in Zitadel. This also applies to a trusted connection,
   because trust covers the provider's `amr` and not the time of the sign-in. An
   `auth_time` after the attempt started (allowing a small clock-skew window) is
   within the limit of that attempt.
7. The rules depend on the two values, not on the ID token, so a connection of
   another protocol can supply them in another way. Plain OAuth connections lack
   ID tokens, so they do not count as a factor type, fail age limits and recent
   checks, and do not count for an enrollment or a method change (rule 5), until
   they supply equivalent values ([Open question 6](#open-questions)).

_(Requesting stronger auth from a provider is deferred to
[Open question 4](#open-questions).)_

#### 4.6 Changing Authentication Methods

A signed-in user can add a method, remove a method, change their password, or
create a set of recovery codes
([ADR 038](038-user-credential-migration-and-recovery.md#recovery-codes)). A
change of this kind decides who can sign in to the account later, so a session
alone does not permit it. The change runs inside an attempt on the user's
session, and the following rules apply to it:

1. Before the change, the user must complete at least one fresh check in the
   same attempt (older session checks do not count), also when the project has
   no policy. The checks must meet the policy. A user who has enrolled methods
   of both factor types, such as a password and TOTP, completes a check of each
   type, even when the policy does not require `mfa`.
   - A passkey with user verification is required to add another passkey
     ([#3202](https://github.com/zitadel/nextgen/issues/3202)) and to remove one
     (rule 5). For other changes it is one way to meet the policy, and not a
     requirement.
   - Users who have only an external sign-in sign in through the provider again
     ([§4.5](#45-external-sign-in), rule 5).

2. Requests to add/remove that arrive before these checks are complete are
   refused.
3. Recovery checks cannot authorize method changes, except for replacing a lost
   method under [Account Recovery](#44-account-recovery).
4. Enrolling the first method of a factor type follows `first_enrollment`,
   preventing users refused under
   `acr_values=urn:zitadel:loa:1fa:phr` from bypassing the refusal
   via account settings. Whether this also holds when `first_enrollment` is not
   set is open ([Open question 7](#open-questions)).
5. Removing a passkey requires verifying with _another_ passkey, and users with
   only one passkey need an administrator
   ([#3202](https://github.com/zitadel/nextgen/issues/3202),
   [Open question 1](#open-questions)).
6. Changing or removing a method ends all other sessions of the user, whichever
   methods they used. The session in which the user makes the change stays.
   Adding a method leaves every session as it is. A change of this kind is a
   security event
   ([ADR 037](037-token-lifecycle.md#revocation-propagation--invalidation-semantics)):
   an ended session loses its session token at once and its refresh tokens are
   revoked. An access token cannot be revoked and expires at the end of its
   lifetime.
7. Enrolling a method during registration requires no prior check because the
   account is created in the same attempt.

Administrators never add methods directly for a user; they authorize the
enrollment so the user enrolls the method themselves
([First Enrollment](#43-first-enrollment)). The server records each
authorization, each method change, and each resulting session revocation as an
event, with who performed it and when
([ADR-048](048-wide-events-internal-audit-primitive.md)).

## Risks

1. **Age limits shorter than attempt lifetime:** A check completed during an
   attempt counts as within that attempt's age limit
   ([§2](#2-policy-configuration)), and an attempt can stay open for 15 minutes.
   With a 60-second limit, a user can enter a password, complete the second
   check 14 minutes later, and the server accepts the password. The token still
   carries the password's time in `auth_time`, so an app that needs the limit to
   hold exactly must compare `auth_time` with its own limit
   ([§4.2](#42-step-up-and-reauthentication-sensitive-actions)). The same
   applies to a recent check, and the app compares `recent_check_at` with its
   own limit.
2. **Enrollment is the weakest link:** Proof of `mfa` or `phishing_resistant`
   confirms which methods were used, not who enrolled them.
   - _Via recovery:_ Someone with a user's password and recovery code can enroll
     their own passkey and subsequently satisfy `mfa` and `phishing_resistant`,
     also under `first_enrollment: admin` ([§4.4](#44-account-recovery)).
   - _Via `first_enrollment: none`:_ Someone with a stolen sole credential
     (e.g., phished password) can enroll their own passkey and take over the
     account even under `phishing_resistant` ([§4.3](#43-first-enrollment)).
   - _Via `first_enrollment: admin`:_ Self-enrollment is closed; security
     depends on the customer's out-of-band identity verification and on the
     administrator. For a user who has no other method, whoever holds the
     authorization can enroll a passkey, including the administrator who issued
     it. The same holds for a user whose only other method is a password while
     an administrator can set it ([Open question 9](#open-questions)). The event
     record of who authorized it is the only control.
   - _Via a method change:_ A passkey is required only to add or remove a
     passkey ([§4.6](#46-changing-authentication-methods)). A password and a
     TOTP code therefore permit other changes to an account that has a passkey,
     such as adding an SMS method. A policy with `phishing_resistant` prevents
     this.

## Open Questions

1. **Removed or lost methods:**
   Is a lost method removed when its replacement is enrolled after recovery? Can
   a user with one passkey and another method remove that passkey after
   verifying with it, without an admin?
2. **Forgotten passwords:**
   [ADR 038](038-user-credential-migration-and-recovery.md#recovery-codes)
   excludes password resets, leaving no rule for users who forget their password
   while retaining another method. Is a password reset a recovery check, and
   what does it permit?
3. **Long-lived single-app sessions:** Because policies are not evaluated on
   token refresh, or when a session API app reads a session, a stricter policy,
   `max_age_seconds` or `recent_check_seconds` does not affect a user staying in
   one app until session expiry. Should the server evaluate the policy on token
   refresh and on a session read?
4. **Requesting stronger auth from providers:**
   [#3166](https://github.com/zitadel/nextgen/issues/3166) requires asking
   external providers for stronger auth. Which parameter should the server send
   for MFA, and how should it evaluate the response?
5. **Additional trusted connection claims:** Trusted connections currently check
   only `amr` containing `mfa`. Should the server also accept an `acr` claim for
   MFA, or count a single `amr` value (e.g., `pwd`) as one factor type when
   combined with a Zitadel method
   ([#3166](https://github.com/zitadel/nextgen/issues/3166))?
6. **Plain OAuth connections:** Without an ID token, where do methods and
   authentication time come from, and how does the server request fresh
   authentication?
7. **Self-service enrollment when `first_enrollment` is unset:** Refusing
   `acr_values` enrollment only holds if users cannot bypass it via account
   settings. May a password-only user self-enroll a passkey when
   `first_enrollment` is not set?
8. **Proof age in the session API:** Sessions expose per-check `verified_at`
   timestamps but not which checks were needed. An app that sent `max_age`
   therefore cannot verify the result exactly, as an OIDC app does with
   `auth_time` ([§4.2](#42-step-up-and-reauthentication-sensitive-actions)). It
   can only compare each check's `verified_at` with its limit, which does not
   match the server's comparison. The same applies when an app sends
   `recent_check`. Should the server return both `auth_time` and
   `recent_check_at`?
9. **Admin password setting:** `setUserPassword` currently requires only
   `user.write`, letting admins set a known password. Should admins retain this
   capability?
10. **Initial `required_factors` without a flow:** Session API attempts have no
    flow definition, so the user schema is unknown until after the identifier is
    provided. Which methods should the initial list return in a multi-schema
    project?
11. **Email codes and magic links:**
    [ADR 038](038-user-credential-migration-and-recovery.md#magic-links-and-email-codes)
    defines both as methods and recovery routes, but this ADR has no rules for
    them. The server returns the code or the link in the API response and the
    app delivers it, as `createInvitation` does for its link.
    [#3166](https://github.com/zitadel/nextgen/issues/3166) names email only as
    an identifier. Does an email code count as possession, like an SMS code, or
    as no factor type?
    [NIST SP 800-63B-4 §3.1.3.1](https://pages.nist.gov/800-63-4/sp800-63b.html#ooba)
    says: "Email SHALL NOT be used for out-of-band authentication because it may
    be vulnerable to" access using only a password, interception in transit or
    at intermediate mail servers, and rerouting attacks.
12. **Trusted devices and biometrics:**
    [#3166](https://github.com/zitadel/nextgen/issues/3166) cites both as
    examples, but the server does not track trusted devices and UV does not
    distinguish PIN from biometric. Should either become an `acr_values` value?
13. **Admin-authorized enrollment:** Which permission issues the authorization,
    since `user.write` is too broad (Gap 8)?
    [#3202](https://github.com/zitadel/nextgen/issues/3202) also leaves open
    what the administrator checks before authorizing.
14. **Recovery when two methods are lost:** A user with a password, a TOTP
    method and a passkey loses the TOTP method and the passkey. Under
    [§4.4](#44-account-recovery), the password and one recovery check permit
    enrolling a new passkey, and the lost TOTP method is not checked. Is one
    recovery check enough in this case, or does this user need an administrator?

## Gaps in the server today

1. **Enrollment without a verified credential.** The server does not check the
   proof before it enrolls a passkey for an existing user
   (`PreparePasskeyRegistrationChallenge` in `internal/domain/auth_attempt.go`).
   A flow definition with the `login` purpose can offer `passkey_register` on
   the step after the identifier step. In a test of that flow through
   `POST /flows`, a caller who submitted only the email of an existing user
   enrolled a passkey for that user, and the flow completed with a handoff
   token. The shipped flow definitions offer `passkey_register` only on the
   sign-up step.
2. **No recovery check.** The server has storage for recovery codes
   (`internal/domain/user_recover_codes.go`), but it does not create a code, and
   it has no check type that verifies one.
3. **A passkey challenge returns the user's credential IDs after the identifier
   alone.** For a user who has a passkey, the challenge lists the credential IDs
   of the user's passkeys, and for a user without a passkey it lists no
   credential IDs (`buildChallenge` in `internal/service/auth_attempt.go`,
   `CreatePasskeyChallenge` in `internal/domain/user_passkey.go`). The attempt
   API and a flow both use this challenge.
4. **A challenge of every type is accepted at every point in an attempt.** The
   check on the challenge type is commented out (`PrepareChallenge` in
   `internal/domain/auth_attempt.go`), so the order of the checks is not
   restricted.
5. **No claims from a provider.** The server stores neither `amr` nor
   `auth_time` on the check of an external sign-in (`AuthFactorSSO` in
   `internal/domain/auth_check_type_sso.go`), and it does not send `max_age` to
   a provider (`internal/idp`).
6. **The request parameters are not compared.** `POST /auth_attempts` has no
   `acr_values`, no `max_age` and no `recent_check` field. A flow stores the
   `acr` value that an authorization request asked for and does not read it
   (`RequestedACR` in `internal/domain/flow_state.go`). `assurance_levels` in
   the session is always empty (`internal/api/session.go`).
7. **No way for a user to change a method.** The API has no operation that
   removes a passkey, and `setUserPassword` requires `user.write`. A user can
   only add a passkey today, through an attempt. The storage layer can delete a
   passkey (`DeleteUserPasskey`), but nothing calls it.
8. **A caller with `user.write` can enroll a passkey for a user.**
   `createUserPasskeyRegistration` and `completeUserPasskeyRegistration` require
   only `user.write`, so the caller completes the registration without the
   user's involvement.
9. **A password check does less work for a user without a password.** The server
   rejects the check before it computes a hash when the user has no password,
   and after the hash when the password is wrong
   (`internal/service/auth_attempt.go`).
