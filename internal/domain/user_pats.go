package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type UserPAT struct {
	ProjectID  string
	TokenID    string
	UserID     string
	Name       *string
	Scopes     []string
	ExpiresAt  *time.Time
	LastUsedAt *time.Time
	CreatedAt  time.Time
}

type CreateUserPAT struct {
	ProjectID string
	TokenID   string
	UserID    string
	Name      *string
	Scopes    []string
	ExpiresAt *time.Time
}

type UserPATRepository interface {
	Repository

	userPATColumns
	userPATConditions
	userPATChanges

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*UserPAT, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*UserPAT, error)
	Create(ctx context.Context, client database.QueryExecutor, pat *CreateUserPAT) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type userPATColumns interface {
	ProjectID() database.Column
	TokenID() database.Column
	UserID() database.Column
	Name() database.Column
	Scopes() database.Column
	ExpiresAt() database.Column
	LastUsedAt() database.Column
	CreatedAt() database.Column
}

type userPATConditions interface {
	ProjectIDCondition(projectID string) database.Condition
	TokenIDCondition(tokenID string) database.Condition
	PrimaryKeyCondition(projectID, tokenID string) database.Condition
	UserIDCondition(userID string) database.Condition
	ExpiresAtCondition(after, before time.Time) database.Condition
}

type userPATChanges interface {
	SetLastUsedAt(time.Time) database.Change
}
