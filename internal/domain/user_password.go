package domain

import (
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
)

const PrefixUserPassword ResourcePrefix = "upw"

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
	ChangedAt           time.Time
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
