package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// Token is a persisted token record (access, session, PAT, etc.).
// Revocation is modeled as deletion from storage.
type Token struct {
	ProjectID string
	TokenID   string
	UserID    string
	SessionID *string
	Scope     []string
	CreatedAt time.Time
	ExpiresAt *time.Time
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/token.mock.go . TokenRepository

// TokenRepository persists token metadata: identity, scope, optional session and expiry.
type TokenRepository interface {
	Repository

	tokenConditions

	Get(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) (*Token, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*Token, error)
	Create(ctx context.Context, client database.QueryExecutor, token *Token) error
	Delete(ctx context.Context, client database.QueryExecutor, condition database.Condition) error
}

type tokenConditions interface {
	PrimaryKeyCondition(projectID, tokenID string) database.Condition
	ProjectIDCondition(projectID string) database.Condition
	TokenIDCondition(tokenID string) database.Condition
	UserIDCondition(userID string) database.Condition
}
