package domain

import (
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
)

const PrefixUserPassword ResourcePrefix = "upw"

const UserPasswordHistoryDepth = 4

func ErrUserPasswordInvalid() Error {
	return newError("user.password_invalid", "The password provided is invalid.", nil, nil)
}

func HashPassword(password string, hasher crypto.Hasher) (string, error) {
	hash, err := hasher.Hash(password)
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
	VerificationID      *string
	LastSuccessfulCheck *time.Time
	FailedAttempts      int16
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (u *UserPassword) Verify(password string, verifier crypto.HashVerifier) error {
	err := verifier.VerifyHash(u.EncodedHash, password)
	if err != nil {
		return ErrUserPasswordInvalid()
	}
	return nil
}

type SetUserPassword struct {
	// ID is the new password row's id, minted by the dialect when empty. Every
	// set adds a row, so each password gets its own id, which emitters use as
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
	UserPasswordFieldVerificationID
	UserPasswordFieldLastSuccessfulCheck
	UserPasswordFieldFailedAttempts
	UserPasswordFieldCreatedAt
	UserPasswordFieldUpdatedAt
)
