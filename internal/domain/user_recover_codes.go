package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserRecoveryCodes struct {
	ProjectID           string
	UserID              string
	RecoveryCodes       []string
	LastSuccessfulCheck *time.Time
	FailedAttempts      int16
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type CreateRecoveryCodes struct {
	ProjectID     string
	UserID        string
	RecoveryCodes []string
}

type UserRecoveryCodesRepository interface {
	Repository

	userRecoveryCodesColumns
	userRecoveryCodesConditions
	userRecoveryCodesChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserRecoveryCodes, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserRecoveryCodes, error)
	Create(ctx context.Context, client database.QueryExecutor, codes *CreateRecoveryCodes) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userRecoveryCodesColumns interface {
	ProjectID() database.Column
	UserID() database.Column
	RecoveryCodes() database.Column
	LastSuccessfulCheck() database.Column
	FailedAttempts() database.Column
	CreatedAt() database.Column
	UpdatedAt() database.Column
}

type userRecoveryCodesConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	UserIDCondition(userID string) database.Condition
	PrimaryKeyCondition(projectID, userID string) database.Condition
}

type userRecoveryCodesChanges interface {
	SetRecoveryCodes([]string) database.Change
	SetLastSuccessfulCheck(*time.Time) database.Change
	IncrementFailedAttempts() database.Change
	ResetFailedAttempts() database.Change
}
