package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserPassword struct {
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

type CreateUserPassword struct {
	UserID         string
	EncodedHash    string
	ChangeRequired bool
	VerificationID *string
}

type UserPasswordRepository interface {
	Repository

	userPasswordColumns
	userPasswordConditions
	userPasswordChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserPassword, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserPassword, error)
	Create(ctx context.Context, client database.QueryExecutor, user *CreateUserPassword) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userPasswordColumns interface {
	InstanceID() database.Column
	UserID() database.Column
	EncodedHash() database.Column
	ChangeRequired() database.Column
	ChangedAt() database.Column
	VerificationID() database.Column
	LastSuccessfulCheck() database.Column
	FailedAttempts() database.Column
	CreatedAt() database.Column
	UpdatedAt() database.Column
}

type userPasswordConditions interface {
	InstanceIDCondition(instanceID string) database.Condition
	UserIDCondition(userID string) database.Condition
	PrimaryKeyCondition(instanceID, userID string) database.Condition
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
