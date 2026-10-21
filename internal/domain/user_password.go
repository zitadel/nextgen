package domain

import (
	"context"
	"errors"
	"time"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"github.com/zitadel/nextgen/internal/crypto"
)

const PrefixUserPassword ResourcePrefix = "upw"

// MaxPasswordLength is the most Unicode code points a password can have after
// [NormalizePassword].
const MaxPasswordLength = 64

const UserPasswordHistoryDepth = 4

func ErrUserPasswordInvalid() Error {
	return newError("user.password_invalid", "The password provided is invalid.", nil, nil)
}

func ErrUserPasswordEmpty() Error {
	return newError("user.password_empty", "The password must not be empty.", nil, nil)
}

func ErrUserPasswordTooLong() Error {
	return newError("user.password_too_long", "The password is too long for the project's password hashing method.", nil, nil)
}

// ErrUserPasswordHashingBusy answers a password that could not be hashed or
// checked because the server is already hashing as much as it allows
// ([crypto.ErrHashingBusy]). It says nothing about the password, so it is
// never a failed attempt, and the client may retry.
func ErrUserPasswordHashingBusy() Error {
	return newError("user.password_hashing_busy", "The server is hashing too many passwords right now. Try again in a moment.", nil, nil)
}

// PasswordPolicyViolations is the client-facing detail of
// [ErrUserPasswordPolicyViolation]: every failed rule keyed by name with the
// value of the setting it is named after, e.g. {"min_length": 12}, the same
// shape as a flow field's validation.
type PasswordPolicyViolations struct {
	Violations map[string]any `json:"violations"`
}

// ErrUserPasswordPolicyViolation rejects a password that breaks the project's
// password policy or the server's length cap (ADR 066).
func ErrUserPasswordPolicyViolation(violations map[string]any) Error {
	var details any
	if violations != nil {
		details = PasswordPolicyViolations{Violations: violations}
	}
	return newError("user.password_policy_violation", "The password does not meet the password policy.", details, nil)
}

func NormalizePassword(password string) string {
	return norm.NFC.String(password)
}

func HashPassword(ctx context.Context, password string, hasher crypto.Hasher) (string, error) {
	normalized := NormalizePassword(password)
	if normalized == "" {
		return "", ErrUserPasswordEmpty()
	}
	// The password gate reports this as a max_length violation before a
	// password gets here; the check stays as the backstop no path can skip.
	if utf8.RuneCountInString(normalized) > MaxPasswordLength {
		return "", ErrUserPasswordTooLong().WithMessage("The password is too long. It can be at most 64 characters.")
	}
	hash, err := hasher.Hash(ctx, normalized)
	if errors.Is(err, crypto.ErrPasswordTooLong) {
		// bcrypt takes 72 bytes, fewer than 64 code points can need.
		return "", ErrUserPasswordTooLong().
			WithMessage("The password is too long for the project's password hashing method. Choose a shorter password.").
			WithParent(err)
	}
	if errors.Is(err, crypto.ErrHashingBusy) {
		return "", ErrUserPasswordHashingBusy().WithParent(err)
	}
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to hash password")
	}
	return hash, nil
}

type UserPassword struct {
	ID          string
	ProjectID   string
	UserID      string
	EncodedHash string
	CreatedAt   time.Time
}

// Verify checks password against the stored hash. Any answer about the
// password, a mismatch or a hash that cannot be read, is
// [ErrUserPasswordInvalid]. A check that never ran, because the server is
// hashing as much as it allows or the caller gave up waiting, is reported as
// what it is: a caller that counted it as a wrong password would lock the
// user out for the server's load.
func (u *UserPassword) Verify(ctx context.Context, password string, verifier crypto.HashVerifier) error {
	normalized := NormalizePassword(password)
	err := verifier.VerifyHash(ctx, u.EncodedHash, normalized)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, crypto.ErrHashingBusy):
		return ErrUserPasswordHashingBusy().WithParent(err)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	default:
		return ErrUserPasswordInvalid()
	}
}

type SetUserPassword struct {
	// ID is the new password row's id, minted by the dialect when empty. Every
	// set adds a row, so each password gets its own id, which emitters use as
	// entity_id / factor_id.
	ID          string
	ProjectID   string
	UserID      string
	EncodedHash string
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
	UserPasswordFieldCreatedAt
)
