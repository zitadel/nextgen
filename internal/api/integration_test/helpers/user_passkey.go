package helpers

import (
	"context"
	"testing"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
)

// UserPasskeyFixture exposes UserPasskeyStatements helpers for integration tests.
type UserPasskeyFixture struct {
	Pool *service.DB
}

func (h *Harness) EnsureUserPasskeyFixture(t *testing.T) UserPasskeyFixture {
	t.Helper()
	return UserPasskeyFixture{Pool: h.EnsureServiceDB(t)}
}

func (f UserPasskeyFixture) Create(ctx context.Context, passkey *domain.CreateUserPasskey) error {
	return f.Pool.Statements().CreateUserPasskey(ctx, passkey)
}

func (f UserPasskeyFixture) ListByUser(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	result, err := f.Pool.Statements().ListUserPasskeys(ctx, &database.ListOptions[domain.UserPasskeyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
			database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
		),
	})
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}
