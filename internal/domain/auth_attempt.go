package domain

import (
	"slices"
	"time"
)

const (
	PrefixAuthAttempt      ResourcePrefix = "att"
	PrefixChallenge        ResourcePrefix = "ch"
	PrefixHandoffToken     ResourcePrefix = "handoff"
	HandoffTokenExpiration                = time.Minute
)

// ErrAuthAttemptNotFound returns an error indicating that the requested auth attempt was not found.
func ErrAuthAttemptNotFound() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("not_found"), "The auth attempt was not found.", nil, nil)
}

// ErrAuthAttemptInvalidRequest returns an error indicating that the request is invalid.
func ErrAuthAttemptInvalidRequest() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("invalid_request"), "invalid request", nil, nil)
}

// ErrAuthAttemptInvalidState returns an error indicating that the attempt is in an invalid state (e.g. expired).
func ErrAuthAttemptInvalidState() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("invalid_state"), "The auth attempt is in an invalid state for the intended change.", nil, nil)
}

// ErrAuthAttemptAlreadyCompleted returns an error indicating that the attempt is already completed.
func ErrAuthAttemptAlreadyCompleted() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("already_completed"), "The auth attempt is already completed and can no longer be changed.", nil, nil)
}

// ErrAuthAttemptNotCompleted returns an error indicating that the attempt is not completed.
func ErrAuthAttemptNotCompleted() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("not_completed"), "The auth attempt must be completed for any further action.", nil, nil)
}

// ErrAuthAttemptAlreadyHandedOff returns an error indicating that the attempt is already handed off.
func ErrAuthAttemptAlreadyHandedOff() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("already_handed_off"), "The auth attempt was already handed off. No new handoff can be created and the previous token will only be returned if the same Idempotency-Key header is provided.", nil, nil)
}

// ErrAuthAttemptInvalidProof returns an error indicating that the proof is invalid.
func ErrAuthAttemptInvalidProof() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("invalid_proof"), "The proof or request is invalid.", nil, nil)
}

// ErrAuthAttemptProofRejected returns an error indicating that the proof was rejected.
func ErrAuthAttemptProofRejected(err error) Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("proof_rejected"), "The proof was rejected.", nil, err)
}

// ErrAuthAttemptStaleChallenge returns an error indicating that the challenge is stale or has been re-issued.
func ErrAuthAttemptStaleChallenge() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("stale_challenge"), "The challenge is stale or was re-issued.", nil, nil)
}

// AuthAttempt represents the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#auth-flows)
// It is short-lived and should therefore be stored near the client, do not store PII data in it.
type AuthAttempt struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the auth attempt within the project.
	// The storage layer assigns this value on Create (dialect-minted prefixed opaque string).
	ID string

	// HandoffToken is the single-use token minted explicitly with the handoff call after all required factors are verified, used by the client to exchange for a session.
	HandoffToken *HandoffToken
	// HandedOffAt is the timestamp when the handoff token was generated after the attempt was completed.
	HandedOffAt *time.Time

	// Used to link an auth attempt to a session. Use case is step up auth.
	// In this case we need to copy the factors from the session back to the auth attempt.
	SessionID *string

	// Links to the [AuthCheck]s that belong to the auth attempt.
	// An auth attempt can have multiple checks (e.g. for multi-factor authentication), but a check can only belong to one auth attempt.
	Checks         []AuthCheck
	RequiredChecks []AuthCheckType

	// The time when the auth attempt was created, it must be set by the storage and is read-only.
	CreatedAt time.Time

	// TTL describes how long an auth attempt is valid, it should be set to a reasonable value (e.g. 5 minutes) to prevent abuse and to ensure that old auth attempts are cleaned up.
	// An auth attempt gets garbage collected after CreatedAt + TimeToLive, so it is important to set it to a reasonable value to prevent abuse and to ensure that old auth attempts are cleaned up.
	TimeToLive *time.Duration
}

const AuthAttemptTTL = 15 * time.Minute

type AuthAttemptOption func(*AuthAttempt)

// WithSession sets the session ID and copies existing factors from the session to the attempt.
func WithSession(sessionID *string, authFactors ...AuthFactor) AuthAttemptOption {
	checks := make([]AuthCheck, len(authFactors))
	for i, factor := range authFactors {
		checks[i] = factor
	}
	return func(a *AuthAttempt) {
		a.SessionID = sessionID
		a.Checks = checks
	}
}

func NewAuthAttempt(projectID string, requiredChecks []AuthCheckType, opts ...AuthAttemptOption) (*AuthAttempt, error) {
	attempt := &AuthAttempt{
		ProjectID:      projectID,
		RequiredChecks: requiredChecks,
		TimeToLive:     new(AuthAttemptTTL),
	}

	for _, opt := range opts {
		opt(attempt)
	}

	return attempt, nil
}

// CheckAs retrieves a check of the given type from the attempt and casts it to a specific AuthFactor type, returning the typed factor and true if it exists and matches the type.
func CheckAs[T AuthFactor](attempt *AuthAttempt, typ AuthCheckType) (T, bool) {
	check, ok := attempt.FactorByType(typ)
	if !ok {
		var zero T
		return zero, false
	}
	typedCheck, ok := check.(T)
	return typedCheck, ok
}

// IsExpired returns true if the attempt's TTL has elapsed. Returns false if the attempt is not yet initialized (zero CreatedAt) or TTL is nil.
func (a *AuthAttempt) IsExpired() bool {
	if a.CreatedAt.IsZero() || a.TimeToLive == nil {
		return false
	}
	return time.Now().After(a.ExpiresAt())
}

// ExpiresAt returns the timestamp when the attempt expires.
func (a *AuthAttempt) ExpiresAt() time.Time {
	if a.CreatedAt.IsZero() || a.TimeToLive == nil {
		return time.Time{}
	}
	return a.CreatedAt.Add(*a.TimeToLive)
}

// IsCompleted returns true if all required checks are verified successfully.
func (a *AuthAttempt) IsCompleted() bool {
	for _, requiredCheck := range a.RequiredChecks {
		_, ok := a.FactorByType(requiredCheck)
		if !ok {
			return false
		}
	}
	return true
}

// IsHandedOff returns true if a handoff token has been generated.
func (a *AuthAttempt) IsHandedOff() bool {
	return a.HandoffToken != nil
}

// FactorByType returns the verified factor of the given type, if it exists on the attempt.
func (a *AuthAttempt) FactorByType(typ AuthCheckType) (AuthFactor, bool) {
	for _, check := range a.Checks {
		challenge, ok := check.(AuthFactor)
		if ok && challenge.Type() == typ {
			return challenge, true
		}
	}
	return nil, false
}

// ChallengeByType returns the challenge of the given type, if it exists on the attempt.
func (a *AuthAttempt) ChallengeByType(typ AuthCheckType) (AuthChallenge, bool) {
	for _, check := range a.Checks {
		challenge, ok := check.(AuthChallenge)
		if ok && challenge.Type() == typ {
			return challenge, true
		}
	}
	return nil, false
}

// ChallengeByID returns the check with the given challenge ID.
// Used to validate that a client's challenge ID is current before accepting a proof.
func (a *AuthAttempt) ChallengeByID(id string) (AuthChallenge, bool) {
	for _, check := range a.Checks {
		challenge, ok := check.(AuthChallenge)
		if ok && challenge.GetID() == id {
			return challenge, true
		}
	}
	return nil, false
}

// PrepareChallenge validates that a challenge can be issued for the given check type.
func (a *AuthAttempt) PrepareChallenge(typ AuthCheckType) error {
	if a.IsExpired() {
		return ErrAuthAttemptInvalidState()
	}
	if a.IsHandedOff() {
		return ErrAuthAttemptAlreadyHandedOff()
	}
	//found := slices.Contains(a.RequiredChecks, typ). TODO: do we need to restrict this?
	//if !found {
	//	return ErrAuthAttemptInvalidRequest()
	//}
	return nil
}

// PrepareUserChallenge validates that a user challenge can be issued.
// It's prohibited if the auth attempt is linked to a session with a verified user as this could lead to security issues.
// Also, as soon as there are more factors verified than the user (e.g. password) we'll not allow to change the user anymore.
// We'll probably change the latter in the future and reset all factors as soon as the new user challenge succeeded.
func (a *AuthAttempt) PrepareUserChallenge() error {
	if err := a.PrepareChallenge(AuthCheckTypeUser); err != nil {
		return err
	}
	if a.SessionID != nil {
		_, ok := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
		if ok {
			return ErrAuthAttemptInvalidRequest().WithMessage("The user was already authenticated.")
		}
		return nil
	}
	for _, check := range a.Checks {
		if _, ok := check.(AuthFactor); ok && check.Type() != AuthCheckTypeUser {
			return ErrAuthAttemptInvalidRequest().WithMessage("The user must not be changed after it was authenticated.")
		}
	}
	return nil
}

// PreparePasswordChallenge validates that a password challenge can be issued,
// which requires that a user was already identified to prevent issuing password challenges without a known user.
func (a *AuthAttempt) PreparePasswordChallenge() error {
	if err := a.PrepareChallenge(AuthCheckTypePassword); err != nil {
		return err
	}
	_, ok := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
	if !ok {
		return ErrAuthAttemptInvalidRequest().WithMessage("password challenge requires user verification first")
	}
	return nil
}

// PreparePasskeyChallenge validates that a passkey challenge can be issued
// and returns the user ID if the user was already identified.
func (a *AuthAttempt) PreparePasskeyChallenge() (string, error) {
	if err := a.PrepareChallenge(AuthCheckTypePasskey); err != nil {
		return "", err
	}
	userCheck, ok := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
	if !ok {
		return "", nil
	}
	return userCheck.UserID, nil
}

// SetUserChallenge registers a new user challenge on the attempt, replacing any existing challenge of the same type.
func (a *AuthAttempt) SetUserChallenge() *AuthChallengeUser {
	challenge := &AuthChallengeUser{}
	a.SetCheck(challenge)
	return challenge
}

// SetPasswordChallenge registers a new password challenge on the attempt, replacing any existing challenge of the same type.
func (a *AuthAttempt) SetPasswordChallenge() *AuthChallengePassword {
	challenge := &AuthChallengePassword{}
	a.SetCheck(challenge)
	return challenge
}

func (a *AuthAttempt) SetPasskeyChallenge(passkeyChallenge *PasskeyChallenge) *AuthChallengePasskey {
	challenge := &AuthChallengePasskey{
		PasskeyChallenge: passkeyChallenge,
	}
	a.SetCheck(challenge)
	return challenge
}

// PrepareVerification verifies that the attempt is not expired or handed off, that the given challenge ID exists (preventing stale proofs), and that the proof type matches the challenge's type.
func (a *AuthAttempt) PrepareVerification(challengeID string, checkType AuthCheckType) (AuthChallenge, error) {
	if a.IsExpired() {
		return nil, ErrAuthAttemptInvalidState()
	}
	if a.IsHandedOff() {
		return nil, ErrAuthAttemptAlreadyHandedOff()
	}
	// Validate the challenge ID is current — prevents stale proofs
	check, ok := a.ChallengeByID(challengeID)
	if !ok {
		return nil, ErrAuthAttemptStaleChallenge()
	}

	// Proof type must match the challenge's check type
	if check.Type() != checkType {
		return nil, ErrAuthAttemptInvalidRequest()
	}
	return check, nil
}

// PrepareUserVerification validates that the attempt is in a state where
// a user (identifier) proof can be submitted.
func (a *AuthAttempt) PrepareUserVerification(challengeID string) (AuthChallenge, error) {
	challenge, err := a.PrepareVerification(challengeID, AuthCheckTypeUser)
	if err != nil {
		return nil, err
	}
	for _, check := range a.Checks {
		if _, ok := check.(AuthFactor); ok && check.Type() != AuthCheckTypeUser {
			return nil, ErrAuthAttemptInvalidRequest().WithMessage("The user must not be changed after it was authenticated.")
		}
	}
	return challenge, nil
}

// PreparePasswordVerification validates that a password proof can be submitted
// and returns the user ID to verify against.
func (a *AuthAttempt) PreparePasswordVerification(challengeID string) (AuthChallenge, *AuthFactorUser, error) {
	challenge, err := a.PrepareVerification(challengeID, AuthCheckTypePassword)
	if err != nil {
		return nil, nil, err
	}
	userCheck, ok := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
	if !ok {
		return nil, nil, ErrAuthAttemptInvalidRequest()
	}
	return challenge, userCheck, nil
}

// PreparePasskeyVerification validates that a passkey proof can be submitted.
// It returns the already-identified user when one is pinned (identified login),
// or a nil user factor for a discoverable/usernameless login where the user is
// resolved cryptographically from the assertion's user handle.
//
// Allowing a nil user factor is safe because subject-switching is structurally
// prevented: when a user is already pinned, verification runs the identified
// path constrained to that user's credentials, so an assertion from any other
// credential simply fails. A nil user factor only occurs on a clean attempt
// (a password factor cannot exist without a user factor), so discoverable login
// cannot override an authenticated subject.
func (a *AuthAttempt) PreparePasskeyVerification(challengeID string) (AuthChallenge, *AuthFactorUser, error) {
	challenge, err := a.PrepareVerification(challengeID, AuthCheckTypePasskey)
	if err != nil {
		return nil, nil, err
	}
	// userCheck is nil for a discoverable login; the caller resolves and binds
	// the user from the verified assertion in that case.
	userCheck, _ := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
	return challenge, userCheck, nil
}

// SetUserFactor registers a verified user factor on the attempt, overwriting existing factors of the same type and clearing any associated challenges.
func (a *AuthAttempt) SetUserFactor(user *User) *AuthFactorUser {
	factor := &AuthFactorUser{
		UserID: user.ID,
	}
	a.SetCheck(factor)
	return factor
}

// SetPasswordFactor registers a verified password factor on the attempt, overwriting existing factors of the same type and clearing any associated challenges.
func (a *AuthAttempt) SetPasswordFactor() *AuthFactorPassword {
	factor := &AuthFactorPassword{}
	a.SetCheck(factor)
	return factor
}

func (a *AuthAttempt) SetPasskeyFactor(passkeyVerification *PasskeyVerification) *AuthFactorPasskey {
	factor := &AuthFactorPasskey{
		UserVerified:   passkeyVerification.UserVerified,
		UserID:         passkeyVerification.UserID,
		CredentialID:   passkeyVerification.CredentialID,
		BackupEligible: passkeyVerification.BackupEligible,
		BackupState:    passkeyVerification.BackupState,
	}
	a.SetCheck(factor)
	return factor
}

// PrepareHandoff validates that a handoff can be issued.
// And will generate and store the handoff token.
// Note: The HandoffToken is generated using a crypto/rand token and stored in a hashed way for security reasons.
func (a *AuthAttempt) PrepareHandoff() error {
	if a.IsExpired() {
		return ErrAuthAttemptInvalidState()
	}
	if !a.IsCompleted() {
		return ErrAuthAttemptNotCompleted()
	}
	if a.IsHandedOff() {
		return ErrAuthAttemptAlreadyHandedOff()
	}

	token, err := newHandoffToken()
	if err != nil {
		return err
	}
	a.HandoffToken = token
	return nil
}

// SetCheck sets a check to the given check.
// In the case of an AuthChallenge, it will overwrite an existing challenge of the same type but keep factors of the same type.
// In the case of an AuthFactor, it will overwrite an existing factor of the same type and remove challenges of the same type.
func (a *AuthAttempt) SetCheck(check AuthCheck) {
	for i, c := range a.Checks {
		if c.Type() != check.Type() {
			continue
		}
		if _, ok := check.(AuthChallenge); ok {
			if _, ok := c.(AuthChallenge); ok {
				a.Checks[i] = check
				return
			}
		}
		if _, ok := check.(AuthFactor); ok {
			a.Checks[i] = check
			a.Checks = slices.DeleteFunc(a.Checks, func(c AuthCheck) bool {
				if c.Type() != check.Type() {
					return false
				}
				_, ok := c.(AuthChallenge)
				return ok
			})
			return
		}
	}
	a.Checks = append(a.Checks, check)
}
