package domain

import (
	"time"

	"golang.org/x/text/unicode/norm"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/policy"
)

const PrefixUserPassword ResourcePrefix = "upw"

// PasswordMinLengthFloor is the lowest minimum password length the platform
// accepts anywhere: NIST SP 800-63B's hard floor (eight characters, and only
// for passwords used inside multi-factor authentication). It is the fallback
// the login surface renders when no policy is reachable and the `minimum`
// the `user.password.save` template declares for `min_length`; the two are
// kept equal by test. The default a project starts on is 15 and lives in the
// template.
const PasswordMinLengthFloor = 8

func ErrUserPasswordInvalid() Error {
	return newError("user.password_invalid", "The password provided is invalid.", nil, nil)
}

// NormalizePassword applies NFC, the canonical form NIST SP 800-63B asks
// for, so the same keystrokes hash and verify identically whichever form the
// client sent. Every length check, blocklist check, hash and verification
// runs on the normalized string.
func NormalizePassword(password string) string {
	return norm.NFC.String(password)
}

func HashPassword(password string, hasher crypto.Hasher) (string, error) {
	hash, err := hasher.Hash(NormalizePassword(password))
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to hash password")
	}
	return hash, nil
}

type UserPassword struct {
	ID                  string
	ProjectID           string
	UserID              string
	EncodedHash         string
	ChangeRequired      bool
	ChangedAt           time.Time
	VerificationID      *string
	LastSuccessfulCheck *time.Time
	FailedAttempts      int16
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (u *UserPassword) Verify(password string, verifier crypto.HashVerifier) error {
	err := verifier.VerifyHash(u.EncodedHash, NormalizePassword(password))
	if err != nil {
		return ErrUserPasswordInvalid()
	}
	return nil
}

type SetUserPassword struct {
	// ID is the password row id. Dialects mint on create and overwrite with the
	// persisted id on upsert (RETURNING / equivalent) so emitters can set
	// entity_id / factor_id.
	ID             string
	ProjectID      string
	UserID         string
	EncodedHash    string
	ChangeRequired bool
	VerificationID *string
}

// UserPasswordField enumerates the fields of UserPassword which can be used for
// filtering and ordering in storage statements.
type UserPasswordField uint8

const (
	UserPasswordFieldUnspecified UserPasswordField = iota
	UserPasswordFieldID
	UserPasswordFieldProjectID
	UserPasswordFieldUserID
	UserPasswordFieldEncodedHash
	UserPasswordFieldChangeRequired
	UserPasswordFieldChangedAt
	UserPasswordFieldVerificationID
	UserPasswordFieldLastSuccessfulCheck
	UserPasswordFieldFailedAttempts
	UserPasswordFieldCreatedAt
	UserPasswordFieldUpdatedAt
)

// ErrUserPasswordPolicyViolation is returned when the candidate password
// fails the `user.password.save` policy. Details carry the violated rules
// with the public settings they read, so a client can render what was
// missed (ADR 066).
func ErrUserPasswordPolicyViolation(violations []policy.Violation) Error {
	return newError("user.password_policy_violation", "The password does not satisfy the password policy. Check the details for the violated rules.", PasswordPolicyViolationDetails{Violations: violations}, nil)
}

// PasswordPolicyViolationDetails is the wire shape of a policy denial.
type PasswordPolicyViolationDetails struct {
	Violations []policy.Violation `json:"violations"`
}
