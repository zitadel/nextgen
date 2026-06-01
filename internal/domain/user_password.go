package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func ErrUserPasswordInvalid() Error {
	return newError("user.password_invalid", "The password provided is invalid.", nil, nil)
}

func HashPassword(password string, hasher crypto.Hasher) (string, error) {
	hash, err := hasher.Hash(password)
	if err != nil {
		return "", ErrInternal(err).WithMessage("failed to has password")
	}
	return hash, nil
}

type UserPassword struct {
	ID                  int64
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

type CreateUserPassword struct {
	ProjectID      string
	UserID         string
	EncodedHash    string
	ChangeRequired bool
	VerificationID *string
}

type UserPasswordRepository interface {
	Repository

	userPasswordConditions
	userPasswordChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserPassword, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserPassword, error)
	Upsert(ctx context.Context, client database.QueryExecutor, projectID string, teamID *string, userID string, encodedHash string) error
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUserPassword) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userPasswordConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	UserIDCondition(userID string) database.Condition
	PrimaryKeyCondition(id int64) database.Condition
	UniqueCondition(projectID, userID string) database.Condition
}

type userPasswordChanges interface {
	SetEncodedHash(hash string) database.Change
	SetChangeRequired(bool) database.Change
	SetChangedAt(time.Time) database.Change
	SetVerificationID(string) database.Change
	SetLastSuccessfulCheck(time.Time) database.Change
	IncrementFailedAttempts() database.Change
	ResetFailedAttempts() database.Change
}
