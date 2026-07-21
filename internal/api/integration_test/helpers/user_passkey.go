package helpers

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// UserPasskeyFixture exposes UserPasskeyStatements helpers for integration tests.
type UserPasskeyFixture struct {
	Pool *service.DB
}

func (h *Harness) EnsureUserPasskeyFixture(t *testing.T) UserPasskeyFixture {
	t.Helper()
	return UserPasskeyFixture{Pool: h.ServiceDB(t)}
}

func (f UserPasskeyFixture) Create(ctx context.Context, passkey *domain.CreateUserPasskey) error {
	return f.Pool.Statements().CreateUserPasskey(ctx, passkey)
}

func (f UserPasskeyFixture) Get(ctx context.Context, projectID, userID, credentialID string) (*domain.UserPasskey, error) {
	return f.Pool.Statements().GetUserPasskey(ctx, projectID, userID, credentialID)
}

func (f UserPasskeyFixture) ListByUser(ctx context.Context, projectID, userID string) ([]*domain.UserPasskey, error) {
	result, err := f.Pool.Statements().ListUserPasskeys(ctx, &v2database.ListOptions[domain.UserPasskeyField]{
		Filter: v2database.And(
			v2database.Equal(v2database.Col(domain.UserPasskeyFieldProjectID), projectID),
			v2database.Equal(v2database.Col(domain.UserPasskeyFieldUserID), userID),
		),
	})
	if err != nil {
		return nil, err
	}
	return result.Items, nil
}
