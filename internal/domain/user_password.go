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

const (
	UserPasswordFreeFailures = 5
	UserPasswordBackoffBase  = 30 * time.Second
	UserPasswordBackoffMax   = 15 * time.Minute
	UserPasswordFailureDecay = 24 * time.Hour
)

func ErrUserPasswordRateLimited() Error {
	return newError("user.password_rate_limited", "Too many failed password attempts, try again later.", nil, nil)
}

func HashPassword(password string, hasher crypto.Hasher) (string, error) {
	hash, err := hasher.Hash(password)
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to hash password")
	}
	return hash, nil
}

type UserPassword struct {
	ID                 string
	ProjectID          string
	UserID             string
	EncodedHash        string
	CreatedAt          time.Time
	FailedAttemptCount int
	LastFailedAt       time.Time
}

func (u *UserPassword) NextRetryTime() time.Time {
	if u.LastFailedAt.IsZero() {
		return time.Time{}
	}

	// total number of attempts
	accessAttempts := int64(u.FailedAttemptCount - UserPasswordFreeFailures)
	if accessAttempts <= 0 {
		return time.Time{}
	}

	maxAttempts := int64(UserPasswordBackoffMax / UserPasswordBackoffBase)
	if accessAttempts >= maxAttempts {
		return u.LastFailedAt.Add(UserPasswordBackoffMax)
	}

	timeToWait := time.Duration(int64(UserPasswordBackoffBase) * accessAttempts)
	return u.LastFailedAt.Add(timeToWait)
}

func (u *UserPassword) VerifyRateLimited(password string, verifier crypto.HashVerifier) error {
	nextRetryTime := u.NextRetryTime()
	if nextRetryTime.After(time.Now()) {
		return ErrUserPasswordRateLimited()
	}

	err := verifier.VerifyHash(u.EncodedHash, password)
	if err != nil {
		if time.Since(u.LastFailedAt) >= UserPasswordFailureDecay {
			u.FailedAttemptCount = 0
		}
		u.FailedAttemptCount++
		u.LastFailedAt = time.Now()
		return ErrUserPasswordInvalid()
	}

	u.FailedAttemptCount = 0
	u.LastFailedAt = time.Time{}
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
