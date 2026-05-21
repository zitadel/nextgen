package domain

import (
	"context"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	PrefixAuthAttempt      ResourcePrefix = "att"
	PrefixChallenge        ResourcePrefix = "ch"
	PrefixHandoffToken     ResourcePrefix = "handoff"
	HandoffTokenExpiration                = time.Minute
)

func ErrAuthAttemptNotFound() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("not_found"), "auth attempt not found", nil, nil)
}

func ErrAuthAttemptInvalidRequest() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("invalid_request"), "invalid request", nil, nil)
}

func ErrAuthAttemptInvalidState() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("invalid_state"), "invalid attempt state", nil, nil)
}

func ErrAuthAttemptAlreadyCompleted() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("already_completed"), "The auth attempt is already completed and can no longer be changed.", nil, nil)
}

func ErrAuthAttemptNotCompleted() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("not_completed"), "attempt not in completed state", nil, nil)
}

func ErrAuthAttemptAlreadyHandedOff() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("already_handed_off"), "The auth attempt was already handed off. No new handoff can be created and the previous token will only be returned if the same Idempotency-Key header is provided.", nil, nil)
}

func ErrAuthAttemptInvalidProof() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("invalid_proof"), "invalid proof or request", nil, nil)
}

func ErrAuthAttemptProofRejected() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("proof_rejected"), "proof rejected", nil, nil)
}

func ErrAuthAttemptStaleChallenge() Error {
	return newError(PrefixAuthAttempt.ErrorCodePrefix("stale_challenge"), "challenge is stale or was re-issued", nil, nil)
}

// AuthAttempt represents the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#auth-flows)
// It is short-lived and should therefore be stored near the client, do not store PII data in it.
type AuthAttempt struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the auth attempt within the project.
	// The storage layer assigns this value on Create (database-generated identity).
	ID string

	HandoffToken *HandoffToken
	HandedOffAt  *time.Time

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

func WithSession(sessionID *string, checks ...AuthCheck) AuthAttemptOption {
	return func(a *AuthAttempt) {
		a.SessionID = sessionID
		a.Checks = checks
	}
}

func NewAuthAttempt(projectID string, requiredChecks []AuthCheckType, opts ...AuthAttemptOption) (*AuthAttempt, error) {
	id, err := newID(PrefixAuthAttempt)
	if err != nil {
		return nil, err
	}

	attempt := &AuthAttempt{
		ProjectID:      projectID,
		ID:             id,
		RequiredChecks: requiredChecks,
		TimeToLive:     new(AuthAttemptTTL),
	}

	for _, opt := range opts {
		opt(attempt)
	}

	return attempt, nil
}

func CheckAs[T AuthFactor](attempt *AuthAttempt, typ AuthCheckType) (T, bool) {
	check, ok := attempt.FactorByType(typ)
	if !ok {
		var zero T
		return zero, false
	}
	typedCheck, ok := check.(T)
	return typedCheck, ok
}

func (a *AuthAttempt) IsExpired() bool {
	if a.CreatedAt.IsZero() || a.TimeToLive == nil {
		return false
	}
	return time.Now().After(a.ExpiresAt())
}

func (a *AuthAttempt) ExpiresAt() time.Time {
	if a.CreatedAt.IsZero() || a.TimeToLive == nil {
		return time.Time{}
	}
	return a.CreatedAt.Add(*a.TimeToLive)
}

func (a *AuthAttempt) IsCompleted() bool {
	// An auth attempt is completed if all required checks are verified successfully.
	for _, requiredCheck := range a.RequiredChecks {
		_, ok := a.FactorByType(requiredCheck)
		if !ok {
			return false
		}
	}
	return true
}

func (a *AuthAttempt) IsHandedOff() bool {
	return a.HandoffToken != nil
}

func (a *AuthAttempt) FactorByType(typ AuthCheckType) (AuthFactor, bool) {
	for _, check := range a.Checks {
		challenge, ok := check.(AuthFactor)
		if ok && challenge.Type() == typ {
			return challenge, true
		}
	}
	return nil, false
}

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

// PreparePasswordChallenge validates that a password challenge can be issued.
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

func (a *AuthAttempt) SetUserChallenge() *AuthChallengeUser {
	challenge := &AuthChallengeUser{}
	a.SetCheck(challenge)
	return challenge
}

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

// PrepareUserVerification validates that the attempt is in a state where
// a user (identifier) proof can be submitted.
func (a *AuthAttempt) PrepareUserVerification() error {
	if a.IsExpired() {
		return ErrAuthAttemptInvalidState()
	}
	if a.IsHandedOff() {
		return ErrAuthAttemptAlreadyHandedOff()
	}
	for _, check := range a.Checks {
		if _, ok := check.(AuthFactor); ok && check.Type() != AuthCheckTypeUser {
			return ErrAuthAttemptInvalidRequest().WithMessage("The user must not be changed after it was authenticated.")
		}
	}
	return nil
}

// PreparePasswordVerification validates that a password proof can be submitted
// and returns the user ID to verify against.
func (a *AuthAttempt) PreparePasswordVerification() (*AuthFactorUser, error) {
	if a.IsExpired() {
		return nil, ErrAuthAttemptInvalidState()
	}
	if a.IsHandedOff() {
		return nil, ErrAuthAttemptAlreadyHandedOff()
	}
	userCheck, ok := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
	if !ok {
		return nil, ErrAuthAttemptInvalidRequest()
	}
	return userCheck, nil
}

// PreparePasskeyVerification validates that a passkey proof can be submitted
// and returns the user ID to verify against if there was a user identified already.
func (a *AuthAttempt) PreparePasskeyVerification() (string, error) {
	if a.IsExpired() {
		return "", ErrAuthAttemptInvalidState()
	}
	if a.IsHandedOff() {
		return "", ErrAuthAttemptAlreadyHandedOff()
	}
	userCheck, ok := CheckAs[*AuthFactorUser](a, AuthCheckTypeUser)
	if !ok {
		return "", nil
	}
	return userCheck.UserID, nil
}

func (a *AuthAttempt) SetUserFactor(user *User) *AuthFactorUser {
	factor := &AuthFactorUser{
		UserID: user.ID,
	}
	a.SetCheck(factor)
	return factor
}

func (a *AuthAttempt) SetPasswordFactor() *AuthFactorPassword {
	factor := &AuthFactorPassword{}
	a.SetCheck(factor)
	return factor
}

func (a *AuthAttempt) SetPasskeyFactor(passkeyVerification *PasskeyVerification) *AuthFactorPasskey {
	factor := &AuthFactorPasskey{
		UserVerified: passkeyVerification.UserVerified,
		UserID:       passkeyVerification.UserID,
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

type AuthAttemptRepository interface {
	// GetByID retrieves a single AuthAttempt by its ID and project ID.
	GetByID(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) (*AuthAttempt, error)
	// GetByHandoffToken retrieves a single AuthAttempt by its handoff token and project ID.
	GetByHandoffToken(ctx context.Context, client database.QueryExecutor, projectID, handoffToken string) (*AuthAttempt, error)
	// Create stores an auth attempt including all defined fields (except read-only fields).
	// The repository MUST set the [AuthAttempt.CreatedAt] field to the current time.
	// The repository MUST store [AuthAttempts.Checks] following this recipe:
	//  - If the check does implement [AuthFactor], it MUST SET `LastVerifiedAt`.
	//  - If the check does implement [AuthChallenge], it MUST set `LastChallengedAt`.
	Create(ctx context.Context, client database.QueryExecutor, authAttempt *AuthAttempt) error
	// Delete an auth attempt by its ID and project ID.
	Delete(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string) error

	// Handoff stores the handoff token for an auth attempt and sets the handoff time to the current time.
	Handoff(ctx context.Context, client database.QueryExecutor, attempt *AuthAttempt) error

	// SetChallenge sets a check to challenged and sets the challenge payload.
	// If the check is not stored yet, the method creates a new check with the given type and challenge payload, otherwise it updates the existing check with the new challenge payload and id.
	// The repository MUST call [AuthChallenge.SetID] with the generated id, [AuthChallenge.SetLastChallengedAt] with the current time, reset the [AuthChallenge.SetLastFailedAt] to nil and reset the [AuthChallenge.SetFailureCount] to 0, and store the values accordingly.
	SetChallenge(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge AuthChallenge) error
	// ChallengeSucceeded sets the [AuthFactor.SetLastVerifiedAt] to the current time and stores it accordingly and removes the challenge payload from the storage.
	// The factor must be stored already as an [AuthChallenge], with the same ID.
	// The factor's payload MUST be stored by the repository.
	ChallengeSucceeded(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, factor AuthFactor, challengeID string) error
	// ChallengeFailed sets a challenge to failed.
	// The challenge must be stored already as an [AuthChallenge], with the same ID.
	// The [AuthChallenge.SetLastFailedAt] must be called with the current time and the [AuthChallenge.SetFailureCount] increased by 1, and store the values accordingly.
	ChallengeFailed(ctx context.Context, client database.QueryExecutor, projectID, authAttemptID string, challenge AuthChallenge) error
}
