package helpers

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// UserPasskeyFixture exposes UserPasskeyStatements helpers for integration tests.
type UserPasskeyFixture struct {
	Pool *service.DB
}

func (h *Harness) EnsureUserPasskeyFixture(t *testing.T) UserPasskeyFixture {
	t.Helper()
	return UserPasskeyFixture{Pool: h.EnsureServiceDB(t)}
}

func userPasskeyKeyFilter(projectID, userID, credentialID string) database.Filter[domain.UserPasskeyField] {
	return database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credentialID),
	)
}

func (f UserPasskeyFixture) Create(ctx context.Context, passkey *domain.CreateUserPasskey) error {
	return f.Pool.Statements().CreateUserPasskey(ctx, passkey)
}

func (f UserPasskeyFixture) Get(ctx context.Context, projectID, userID, credentialID string) (*domain.UserPasskey, error) {
	return f.Pool.Statements().GetUserPasskey(ctx, userPasskeyKeyFilter(projectID, userID, credentialID))
}

func (f UserPasskeyFixture) ListByUser(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	return service.UserPasskeyStatementsStore{Pool: f.Pool}.ListByUser(ctx, projectID, userID)
}
