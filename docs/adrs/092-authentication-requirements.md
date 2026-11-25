# ADR 092: Authentication Requirements

> **Status:** Draft
> **Date:** 2026-11-17
> **Context:** [#3166](https://github.com/zitadel/nextgen/issues/3166) and
> [#3202](https://github.com/zitadel/nextgen/issues/3202)
> **Related:** [ADR 010](010-session-auth-attempt-check-model.md),
> [ADR 038](038-user-credential-migration-and-recovery.md),
> [ADR 053](053-cross-project-principals.md),
> [ADR 066](066-operation-policies.md),
> [ADR 078](078-abuse-prevention-in-layers.md),
> [ADR 085](085-which-release-serves-a-request.md)

This ADR proposes how a customer states which authentication a project requires
from its users, and how the server enforces it.

## Context

Customers do not all need the same authentication from their users. They might
need multi-factor authentication (MFA) from every user of a project, only from the administrators of their app, 
or let their users sign in with a password and ask them to verify again before a sensitive action, such as updating payment details.

All of these cases require reading the requirement, comparing it against the
user's completed checks, and prompting only for the checks that are missing.
This ADR proposes one unified model covering project-wide MFA and stricter or
fresh authentication requested by an app (such as for administrators or
sensitive actions). Policies scoped to subsets of users (e.g., a team or role)
are out of scope; [#3166](https://github.com/zitadel/nextgen/issues/3166) defers
finer applicability to a later slice.

## Terminology

| Term                       | Definition                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Method**                 | A way to authenticate (e.g., password, passkey, TOTP code).                                                                                                                   |
| **Enroll**                 | Adding a method to a user's account for future authentication.                                                                                                                |
| **Factor type**            | What a method proves: something the user knows, has, or is.                                                                                                                   |
| **User verification (UV)** | Authenticator verification via PIN or biometric ([WebAuthn](https://www.w3.org/TR/webauthn-3/#user-verification)), reported in the assertion's UV flag.                       |
| **Policy**                 | A project's operation policy holding the settings in this ADR ([ADR 066](066-operation-policies.md)), deployed with a release.                                                |
| **Check**                  | A single completed verification in a session: a completed method, external sign-in, or recovery check.                                                                        |
| **Proof**                  | The checks completed in a session, each with its completion timestamp.                                                                                                        |
| **Requirement**            | What the proof must satisfy, defined by policy and optionally tightened by a request.                                                                                         |
| **Attempt**                | A series of challenges to complete checks. Completing an attempt creates a session or appends checks to an existing one ([ADR 010](010-session-auth-attempt-check-model.md)). |
| **App**                    | The customer's application (via the session API or as an OIDC/OAuth client), including its backend API that consumes tokens.                                                  |

## Proposal

### 1. Model

The server compares the active requirement against the proof in the user's
session. If the proof satisfies the requirement, the user proceeds without a
prompt. Otherwise, the server prompts only for the missing checks.

A requirement has three properties. The policy sets the baseline for every
session in the project; a request can tighten any property for a single action
but never weaken it, so the stricter value of each property applies.

The table shows the policy setting and the request parameter for each property.

| Property            | What the proof has to show                                                  | Setting in the policy | Parameter in a request |
| ------------------- | --------------------------------------------------------------------------- | --------------------- | ---------------------- |
| Strength            | At least two different factor types                                         | `mfa`                 | `acr_values=mfa`       |
| Phishing resistance | A method that a fake login page cannot capture and reuse                    | `phishing_resistant`  | `acr_values=phr`       |
| Age                 | Every check that counts toward the requirement is within a limit in seconds | `max_age_seconds`     | `max_age`              |

- **Combining strength and phishing resistance:** A request requiring both sends
  `acr_values=mfa-phr`. Sending `mfa` and `phr` as separate space-delimited
  values does not require both, because OpenID Connect treats multiple
  `acr_values` as an ordered preference list and returns only one in the token's
  `acr` claim
  ([OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)).
- **Age applies to every required check:** Under `mfa` with a 5-minute limit, a
  2-hour-old password must be repeated even if the TOTP code is 1 minute old.

#### Evaluation Triggers and Timing

The following table shows the situations in which the server makes the
comparison and the requirement that it compares in each situation.

| Situation             | Trigger                                                                | Requirement evaluated                                                                   |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Sign-in**           | User initiates sign-in.                                                | Policy ([§4.1](#41-sign-in-and-session-reuse))                                          |
| **Session reuse**     | Signed-in user returns to the app or opens another app in the project. | Policy ([§4.1](#41-sign-in-and-session-reuse))                                          |
| **Sensitive action**  | App sends `acr_values`, `max_age`, or both.                            | Policy + Request ([§4.2](#42-step-up-and-reauthentication-sensitive-actions))           |
| **Method management** | User's session requests a change to their own methods.                 | Policy + fresh checks in the same attempt ([§4.6](#46-changing-authentication-methods)) |

- **Two-point evaluation:** The server evaluates at attempt **creation** (to
  find missing checks) and again at **completion**.
- **Age at completion:** A check's age is measured when the attempt completes.
  Because an attempt can stay open for 15 minutes, a check that was fresh at
  creation may expire before completion and need to be repeated.
- **Release pinning:** An attempt stays pinned to the release under which it was
  created; both evaluations use that release's policy even if a newer release
  deploys in between ([#3202](https://github.com/zitadel/nextgen/issues/3202)).

#### Supported Features

The table shows how the model handles each feature from
[#3166](https://github.com/zitadel/nextgen/issues/3166). What it does not cover
yet is listed under [Open questions](#open-questions).

| Feature                | How the model handles it                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Mandatory MFA**      | Policy sets `mfa`; every sign-in is evaluated against it.                                                                |
| **Step-up**            | Proof lacks a factor type or phishing-resistant method; apps trigger it via `acr_values=mfa`, `phr`, or `mfa-phr`.       |
| **Reauthentication**   | Proof is too old; the user repeats checks exceeding the age limit.                                                       |
| **Conditional MFA**    | App evaluates custom conditions (e.g., a stricter workspace) and sends `acr_values` when they apply.                     |
| **Adaptive MFA**       | The app or an external service assesses risk. The app sends `acr_values` to step up, or blocks the attempt on rejection. |
| **Ongoing evaluation** | Server re-evaluates policy on every session reuse; apps send a new request when circumstances change.                    |

### 2. Policy Configuration

Requirements express **expected proof**, not specific methods. User schemas
define available methods via `x-auth-methods`, so enabling a new method requires
no policy change. Enrollment and sign-in read from the same schema, so they
agree on which methods a user can use. Enrolling a method does not remove an
existing sign-in option, because the server compares the proof with the
requirement and not with a list of methods
([#3166](https://github.com/zitadel/nextgen/issues/3166)).

Each method proves a fixed factor type.

- **Knowledge:** Password.
- **Possession:** TOTP code, SMS code, passkey.
- **Passkey with UV:** Counts as **two** factor types only when the UV flag is
  set. When the server needs a second factor from a passkey, it sets
  `user_verification` to `required`.
- **No same-type stacking:** Two possession methods (e.g., TOTP + SMS) count as
  one factor type and do not satisfy `mfa`.
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
    "first_enrollment": "admin"
  }
}
```

The table shows the meaning of each setting.

| Setting              | Type    | Meaning                                                                                                                         |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `mfa`                | boolean | Proof must contain at least two different factor types.                                                                         |
| `phishing_resistant` | boolean | Proof must include a method a fake login page cannot capture and replay (passkeys qualify; password + TOTP does not).           |
| `max_age_seconds`    | integer | Maximum age for every check needed to satisfy the requirement. The server does not compare the proof when a token is refreshed. |
| `first_enrollment`   | enum    | Verification required before enrolling a mandated method ([§4.3](#43-first-enrollment)).                                        |

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
   counts as within that attempt's age limit, enabling `max_age=0` and
   `prompt=login`
   ([OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest);
   see [Risks](#risks)).

### 3. Determining `required_factors`

An attempt returns `required_factors`, the list of methods that the user can
complete next. After each completed method, the server re-evaluates and returns
an updated list until the attempt is `completed`. Because users complete one
method at a time, the list does not need to describe the combinations of methods
that satisfy a requirement.

`required_factors` already exists in the session API, described as the methods
the policy requires to complete the attempt
(`api/openapi/endpoints/auth_attempts/auth-attempt-response.yaml`). The server
returns an empty list on every attempt today (`IsCompleted` in
`internal/domain/auth_attempt.go`), so the new meaning does not break a client.

What the list holds depends on whether the user has completed a check:

- **Before the first check:** Schema-enabled methods that can initiate sign-in
  (password, passkey, external sign-in). In flows, the schema comes from the
  flow definition, keeping the list identical for every identifier.
- **After a check (or for signed-in users):** Enrolled methods that the proof
  still needs. If empty and the attempt is not `completed`, the user must enroll
  a method ([§4.3](#43-first-enrollment)).

#### Anti-Enumeration Rules

A caller with only an email address must not be able to infer an account's
enrolled methods:

- **Uniform pre-check responses:** Identical for every user. Passkey challenges
  omit credential IDs; once a user is identified, only that user's passkeys are
  accepted.
- **No standalone codes:** TOTP codes, SMS codes, and recovery codes are
  accepted only after another check (e.g., password), with appropriate
  rate-limits for failed checks per user and method per
  [ADR 078](078-abuse-prevention-in-layers.md#3-layer-2-guards-are-built-in-and-always-on).
- **Uniform failures:** Checking an unenrolled method (e.g., password or TOTP)
  returns the same error and takes the same time as an incorrect credential.

### 4. How Requirements Apply

#### 4.1 Sign-In and Session Reuse

At sign-in, the server evaluates proof against the policy and requires missing
methods before completion:

1. **Universal enforcement:** Applies identically to flows, session API
   attempts, authorization requests, and custom login pages built on them.
2. **Release validation:** A release is rejected if any user schema cannot
   satisfy its policy (e.g., password-only under `mfa`), identifying the schema
   in the error.
3. **Runtime safeguard:** Sign-in never completes without sufficient proof, even
   if release validation missed an issue
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
4. **Forced enrollment:** Users who cannot satisfy the policy with enrolled
   methods must enroll before sign-in finishes ([§4.3](#43-first-enrollment)).
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
  checks older than `max_age_seconds`, are completed in the same session without
  signing the user out.
- A stricter policy does not end existing sessions. A session is evaluated only
  when its user returns to the app or opens another app, so a user who stays in
  one app keeps access until the session expires. A token refresh is not
  evaluated either, so `max_age_seconds` does not limit how long an app that
  refreshes its tokens keeps access ([Open question 3](#open-questions)).
- With the session API, the server evaluates a session only when the app creates
  an attempt on it (`POST /auth_attempts` with `session_id`). An app that only
  reads the session is not evaluated ([Open question 3](#open-questions)).

#### 4.2 Step-Up and Reauthentication (Sensitive Actions)

Because the server does not know which app actions are sensitive, the app sends
`acr_values`, `max_age`, or both via:

- **Session API:** `acr_values` and `max_age` fields on `POST /auth_attempts`
  (alongside `session_id` and `session_token`).
- **OIDC / OAuth:** `acr_values` and `max_age` on the authorization request
  ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)).

The following rules apply to the values:

- `mfa`, `phr` and `mfa-phr` have identical meaning across all projects. `phr`
  is defined by
  [OpenID Connect EAP ACR Values](https://openid.net/specs/openid-connect-eap-acr-values-1_0.html);
  `mfa` and `mfa-phr` are defined by this ADR.
- Multiple `acr_values` are alternatives in preference order
  ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)); the server selects the
  first value the user can meet with enrolled methods (e.g., for `phr mfa`, a
  user without a passkey falls back to `mfa`).
- `acr_values` and `max_age` can be combined. `max_age=0` and `prompt=login` are
  equivalent
  ([OpenID Connect Core §3.1.2.1](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)).

**Refused requests:** The server refuses a request if:

1. `acr_values` contains no supported value.
2. The user schema cannot satisfy any requested value (refused only **after** a
   completed check).
3. The user must enroll a method to satisfy any value, but `first_enrollment` is
   unset or `admin` (refused only **after** a completed check to prevent
   enumeration; under `first_enrollment: none`, the user enrolls in-flow).

**Error codes:** `unmet_authentication_requirements` for OIDC/OAuth
([spec](https://openid.net/specs/openid-connect-unmet-authentication-requirements-1_0.html))
and `att.unmet_authentication_requirements` for the session API. OpenID Connect
Core allows a server to issue a token with a weaker `acr`. The server refuses
instead, as [RFC 9470 §5](https://www.rfc-editor.org/rfc/rfc9470#section-5)
recommends for access tokens. With `prompt=none`, insufficient proof returns
`login_required`
([OpenID Connect Core §3.1.2.6](https://openid.net/specs/openid-connect-core-1_0.html#AuthError)).

**Reporting the result:**

- **OIDC / OAuth tokens:** Access tokens (and ID tokens for OIDC) include two
  claims. A refreshed token keeps both:
  [RFC 9470 §6.1](https://www.rfc-editor.org/rfc/rfc9470#section-6.1) states
  this for an access token, and
  [OpenID Connect Core §12.2](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse)
  requires it for `auth_time` in an ID token. The claims are:
  - `acr`: First value from `acr_values` satisfied by the proof (omitted if
    `acr_values` was not requested).
  - `auth_time`: The server reports the most recent time it can for the proof.
    Each set of checks that satisfies the requirement is as old as its oldest
    check. The server takes the set that is least old, and `auth_time` is the
    time of the oldest check in that set. A session under `mfa` with a password
    from two hours ago, a TOTP code from one minute ago and a UV passkey from
    five minutes ago therefore gets an `auth_time` of five minutes ago: the
    passkey alone satisfies `mfa`, while the password with the TOTP code is two
    hours old. Without a policy or `acr_values`, the requirement is one
    completed method ([§2](#2-policy-configuration)), so `auth_time` is the time
    of the newest check.

- **Mandatory app validation:** Because authorization parameters transit the
  browser and can be tampered with, the app/API must verify `acr`, and compare
  the age of `auth_time` with its own `max_age`, before allowing the action
  ([OpenID Connect Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)).
  If insufficient, the API returns `insufficient_user_authentication` so the app
  initiates a new request ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)).
- **Session API:** Returns `factors` (each verified check with `verified_at`,
  plus `user_verified` for passkeys) and `assurance_levels` (which of `mfa`,
  `phr`, `mfa-phr` are met; the session does not report the age of the proof,
  see [Open question 8](#open-questions)).
- **User-facing message:** The login page or the app tells the user why a check
  is needed or why it cannot be completed. The server returns `required_factors`
  for the first case and an error code for the second.

#### 4.3 First Enrollment

Users who cannot meet `mfa` or `phishing_resistant` with enrolled methods (e.g.,
anyone without a passkey under `phishing_resistant`) must enroll before sign-in
completes. Enrollment is protected against account takeover via stolen
credentials through the following rules:

1. Before enrolling a method, existing users must complete, in the same attempt,
   at least one check and one check for every factor type they have enrolled
   (such as both a password and TOTP). Older session checks do not count. A user
   who has a passkey must verify with a passkey using user verification; a
   password and an SMS code are not enough
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)). A user whose
   passkey cannot do user verification needs admin-authorized enrollment, and a
   lost passkey follows [§4.4](#44-account-recovery) (see [Risks](#risks)). Once
   enrolled, the new method counts toward the requirement in the same attempt,
   and a passkey counts as two factor types only if its registration has the UV
   flag set.
2. No prior check is required when enrolling during account creation.
3. Users with no method and no external sign-in cannot self-enroll under any
   policy (or without one). An administrator issues a single-use, time-limited,
   user-bound authorization, and the user enrolls the method themselves
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)). When a user who
   has other methods gets an authorization ([§4.4](#44-account-recovery),
   `first_enrollment: admin`), it stands in only for the checks of rule 1 that
   the user cannot complete, so the user still completes the others. How the
   authorization reaches the user, and which permission issues it, is open
   ([Open question 13](#open-questions)).

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
2. A recovery check permits enrolling a replacement for the lost method in the
   same attempt. It substitutes for the check of one method only; all other
   enrolled methods must still be verified.
3. A recovery check alone does not permit the enrollment. A user who cannot
   verify another method requires admin-authorized enrollment
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
4. Enrolling the replacement counts as a check of that method, allowing sign-in
   to complete (under `phishing_resistant`, the replacement must be a passkey)
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
5. A user who cannot complete a recovery check and every user under
   `first_enrollment: admin` require admin-authorized enrollment
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).

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
5. For an enrollment or a method change, the server sends `max_age=0`, so a
   provider that supports it asks the user to authenticate again. The external
   sign-in counts when the provider returns the user during the attempt.
   `auth_time` is required only for an age limit (rules 4 and 6).
6. An external sign-in without `auth_time`, or with an `auth_time` that is older
   than the limit, does not meet an age limit, so the user completes a method in
   Zitadel. An `auth_time` after the attempt started (allowing a small
   clock-skew window) is within the limit of that attempt.
7. The rules depend on the two values, not on the ID token, so a connection of
   another protocol can supply them in another way. Plain OAuth connections lack
   ID tokens, so they do not count as a factor type and fail age limits until
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

1. Before the change, the user must complete fresh checks in the same attempt
   (older session checks do not count), regardless of policy. Users must verify
   at least one method and one per enrolled factor type:
   - Passkey users verify with a UV passkey
     ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
   - Password + TOTP users verify both.
   - Users who have only an external sign-in sign in through the provider again
     ([§4.5](#45-external-sign-in), rule 5).

2. Add or remove requests arriving before these checks are complete are refused.
3. Recovery checks cannot authorize method changes, except for replacing a lost
   method under [Account Recovery](#44-account-recovery).
4. Enrolling the first method of a factor type follows `first_enrollment`,
   preventing users refused under `acr_values=phr` from bypassing the refusal
   via account settings. Whether this also holds when `first_enrollment` is not
   set is open ([Open question 7](#open-questions)).
5. Removing a passkey requires verifying with _another_ passkey, and users with
   only one passkey need an administrator
   ([#3202](https://github.com/zitadel/nextgen/issues/3202),
   [Open question 1](#open-questions)). Removing a passkey terminates all
   sessions authenticated with it
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)).
6. Enrolling a method during registration requires no prior check because the
   account is created in the same attempt.

Administrators never add methods directly for a user; they authorize the
enrollment so the user enrolls the method themselves
([First Enrollment](#43-first-enrollment)). The server records each
authorization, each method change, and each resulting session revocation as an
event, with who performed it and when
([#3202](https://github.com/zitadel/nextgen/issues/3202)).

## Risks

1. **Age limits shorter than attempt lifetime:** Because in-attempt checks
   satisfy the attempt's age limit and attempts can stay open for 15 minutes, a
   60-second limit can accept a check up to 15 minutes old. Exact enforcement
   relies on the app validating `auth_time`
   ([§4.2](#42-step-up-and-reauthentication-sensitive-actions)).
2. **Enrollment is the weakest link:** Proof of `mfa` or `phishing_resistant`
   confirms which methods were used, not who enrolled them.
   - _Via recovery:_ Someone with a user's password and recovery code can enroll
     their own passkey and subsequently satisfy `mfa` and `phishing_resistant`
     ([§4.4](#44-account-recovery)).
   - _Via `first_enrollment: none`:_ Someone with a stolen sole credential
     (e.g., phished password) can enroll their own passkey and take over the
     account even under `phishing_resistant` ([§4.3](#43-first-enrollment)).
   - _Via `first_enrollment: admin`:_ Both self-service routes are closed;
     security depends on the customer's out-of-band identity verification and on
     the administrator. For a user who has no other method, whoever holds the
     authorization can enroll a passkey, including the administrator who issued
     it. The same holds for a user whose only other method is a password while
     an administrator can set it ([Open question 9](#open-questions)). The event
     record of who authorized it is the only control.
   - _Via an external sign-in:_ A provider that does not act on `max_age=0`
     returns the user without a prompt. Under `first_enrollment: none`, someone
     at the browser of a user who has only an external sign-in, with the
     provider session still active, can then enroll their own passkey without
     entering a credential ([§4.5](#45-external-sign-in)).

## Open Questions

1. **Removed or lost methods:**
   [#3166](https://github.com/zitadel/nextgen/issues/3166) lists revocation as a
   stage the model covers, and this ADR has a rule only for passkey removal
   ([#3202](https://github.com/zitadel/nextgen/issues/3202)). What happens to
   sessions containing checks from another removed, replaced, or lost method,
   such as a changed password or a removed TOTP method? Is a lost method removed
   when its replacement is enrolled after recovery? Can a user with one passkey
   and another method remove that passkey after verifying with it, without an
   admin?
2. **Forgotten passwords:**
   [ADR 038](038-user-credential-migration-and-recovery.md#recovery-codes)
   excludes password resets, leaving no rule for users who forget their password
   while retaining another method. Is a password reset a recovery check, and
   what does it permit?
3. **Long-lived single-app sessions:** Because policies are not evaluated on
   token refresh, or when a session API app reads a session, a stricter policy
   or `max_age_seconds` does not affect a user staying in one app until session
   expiry. Should the server evaluate the policy on token refresh and on a
   session read?
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
   match the server's comparison. Should the server return `auth_time`?
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
    them and the server cannot deliver messages today. Should the server return
    a verification code via API for the app to deliver?
12. **Trusted devices and biometrics:**
    [#3166](https://github.com/zitadel/nextgen/issues/3166) cites both as
    examples, but the server does not track trusted devices and UV does not
    distinguish PIN from biometric. Should either become an `acr_values` value?
13. **Admin-authorized enrollment:** How does the authorization reach the user,
    given that the server cannot deliver messages today? Which permission issues
    it, since `user.write` is too broad (Gap 8)?
    [#3202](https://github.com/zitadel/nextgen/issues/3202) also leaves open
    what the administrator checks before authorizing.

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
   `acr_values` and no `max_age` field. A flow stores the `acr` value that an
   authorization request asked for and does not read it (`RequestedACR` in
   `internal/domain/flow_state.go`). `assurance_levels` in the session is always
   empty (`internal/api/session.go`).
7. **No way for a user to change a method.** The API has no operation that
   removes a passkey, and `setUserPassword` requires `user.write`. A user can
   only add a passkey today, through an attempt. The storage layer can delete a
   passkey (`DeleteUserPasskey`), but nothing calls it, and the server cannot
   find the sessions that were authenticated with a passkey.
8. **A caller with `user.write` can enroll a passkey for a user.**
   `createUserPasskeyRegistration` and `completeUserPasskeyRegistration` require
   only `user.write`, so the caller completes the registration without the
   user's involvement.
9. **A password check does less work for a user without a password.** The server
   rejects the check before it computes a hash when the user has no password,
   and after the hash when the password is wrong
   (`internal/service/auth_attempt.go`).
