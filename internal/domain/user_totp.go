package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserTOTP struct {
	ProjectID           string
	UserID              string
	Secret              []byte
	VerifiedAt          time.Time
	LastSuccessfulCheck *time.Time
	FailedAttempts      int16
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type CreateUserTOTP struct {
	ProjectID      string
	UserID         string
	Secret         []byte
	VerificationID *string
}

type UserTOTPRepository interface {
	Repository

	userTOTPColumns
	userTOTPConditions
	userTOTPChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserTOTP, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserTOTP, error)
	Create(ctx context.Context, client database.QueryExecutor, totp *CreateUserTOTP) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userTOTPColumns interface {
	ProjectID() database.Column
	UserID() database.Column
	Secret() database.Column
	VerifiedAt() database.Column
	LastSuccessfulCheck() database.Column
	FailedAttempts() database.Column
	CreatedAt() database.Column
	UpdatedAt() database.Column
}

type userTOTPConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	UserIDCondition(userID string) database.Condition
	PrimaryKeyCondition(projectID, userID string) database.Condition
}

type userTOTPChanges interface {
	SetSecret([]byte) database.Change
	SetVerifiedAt(time.Time) database.Change
	SetLastSuccessfulCheck(time.Time) database.Change
	IncrementFailedAttempts() database.Change
	ResetFailedAttempts() database.Change
}
