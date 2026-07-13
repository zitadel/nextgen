//go:build postgres_integration

package service_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

// seedIdentityUser creates a schema row and a user carrying the conventional
// identity attributes, returning the user ID.
func seedIdentityUser(t *testing.T, pool database.QueryExecutor, projectID string) string {
	t.Helper()
	ensureProject(t, pool, projectID)

	schemaURL := "https://example.com/schemas/human-user"
	_, err := pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, '{}') ON CONFLICT DO NOTHING`,
		projectID, schemaURL,
	)
	require.NoError(t, err)

	// camelCase name parts: the shape the shipped presets actually collect
	// (packages/config/defaults/*.json).
	attrs := make([]*domain.CreateAttribute, 0, 3)
	for key, value := range map[string]any{
		"email":      "ada@example.com",
		"givenName":  "Ada",
		"familyName": "Lovelace",
	} {
		attr, err := domain.NewCreateAttribute(key, value, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		attrs = append(attrs, attr)
	}

	userID := "user_ident-" + time.Now().Format("150405.000000")
	require.NoError(t, repository.NewUserRepository().Create(t.Context(), pool, &domain.CreateUser{
		ProjectID:  projectID,
		SchemaURL:  schemaURL,
		ID:         userID,
		Attributes: attrs,
	}))
	return userID
}

func TestSessionService_Get_UserIdentity_integration(t *testing.T) {
	pool := integrationPoolOrFail(t)
	svc, _ := newSessionServiceForIntegration(t)

	projectID := "p-svc-get-ident-" + time.Now().Format("150405.000000")
	userID := seedIdentityUser(t, pool, projectID)

	session, err := domain.NewSession(projectID, nil)
	require.NoError(t, err)
	require.NoError(t, repository.NewSessionRepository(pool).Create(t.Context(), pool, session))
	_, err = pool.Exec(t.Context(),
		`UPDATE zitadel_nextgen.sessions SET user_id = $1 WHERE project_id = $2 AND id = $3`,
		userID, projectID, session.ID,
	)
	require.NoError(t, err)

	t.Run("hydrates identity when requested", func(t *testing.T) {
		got, err := svc.Get(t.Context(), service.GetSessionInput{
			ProjectID:        projectID,
			SessionID:        session.ID,
			WithUserIdentity: true,
		})
		require.NoError(t, err)
		require.NotNil(t, got.User)
		require.Equal(t, "Ada Lovelace", got.User.DisplayName())
		require.Equal(t, "ada@example.com", got.User.Email())
	})

	t.Run("plain read stays identity-free", func(t *testing.T) {
		got, err := svc.Get(t.Context(), service.GetSessionInput{
			ProjectID: projectID,
			SessionID: session.ID,
		})
		require.NoError(t, err)
		require.Nil(t, got.User)
	})
}
