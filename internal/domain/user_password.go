package domain

import (
	"errors"
	"time"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"github.com/zitadel/zitadel/v5/internal/crypto"
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
	return newError("user.password_too_long", "The password is too long. It can be at most 64 characters.", nil, nil)
}

func NormalizePassword(password string) string {
	return norm.NFC.String(password)
}

func HashPassword(password string, hasher crypto.Hasher) (string, error) {
	normalized := NormalizePassword(password)
	if normalized == "" {
		return "", ErrUserPasswordEmpty()
	}
	if utf8.RuneCountInString(normalized) > MaxPasswordLength {
		return "", ErrUserPasswordTooLong()
	}
	hash, err := hasher.Hash(normalized)
	if errors.Is(err, crypto.ErrPasswordTooLong) {
		// bcrypt takes 72 bytes, fewer than 64 code points can need.
		return "", ErrUserPasswordTooLong().
			WithMessage("The password is too long for the project's password hashing method. Choose a shorter password.").
			WithParent(err)
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

func (u *UserPassword) Verify(password string, verifier crypto.HashVerifier) error {
	normalized := NormalizePassword(password)
	if verifier.VerifyHash(u.EncodedHash, normalized) != nil {
		return ErrUserPasswordInvalid()
	}
	return nil
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
