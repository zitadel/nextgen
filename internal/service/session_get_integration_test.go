//go:build postgres_integration

package service_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// seedIdentityUser creates a schema row and a user carrying the conventional
// identity attributes, returning the user ID.
func seedIdentityUser(t *testing.T, projectID string) string {
	t.Helper()
	ensureProject(t, projectID)

	schemaURL := "https://example.com/schemas/human-user"
	stmts := integrationPoolOrFail(t).Statements()
	require.NoError(t, stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: projectID,
		URL:       schemaURL,
		Schema:    []byte(`{}`),
	}))

	// camelCase name parts: the shape the shipped presets actually collect
	// (packages/config/defaults/*.json).
	attrs := make(domain.CreateAttributes, 0, 3)
	for key, value := range map[domain.AttributeKey]any{
		"email":      "ada@example.com",
		"givenName":  "Ada",
		"familyName": "Lovelace",
	} {
		attr, err := domain.NewCreateAttribute(key, value, domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		attrs = append(attrs, *attr)
	}

	userID := "user_ident-" + time.Now().Format("150405.000000")
	require.NoError(t, stmts.CreateUser(t.Context(), &domain.CreateUser{
		ProjectID:  projectID,
		SchemaURL:  schemaURL,
		ID:         userID,
		Attributes: attrs,
	}))
	return userID
}

func TestSessionService_Get_UserIdentity_integration(t *testing.T) {
	svc, _ := newSessionServiceForIntegration(t)

	projectID := "p-svc-get-ident-" + time.Now().Format("150405.000000")
	userID := seedIdentityUser(t, projectID)

	plain, _ := handoffCompletedAttempt(t, projectID, func(a *domain.AuthAttempt) {
		now := time.Now()
		userFactor := domain.SetAuthFactorUser(now)
		userFactor.UserID = userID
		a.RequiredChecks = []domain.AuthCheckType{domain.AuthCheckTypeUser, domain.AuthCheckTypePassword}
		a.Checks = []domain.AuthCheck{userFactor, domain.SetAuthFactorPassword(now)}
	})
	session, err := svc.Exchange(t.Context(), service.ExchangeInput{
		ProjectID:    projectID,
		HandoffToken: plain,
	})
	require.NoError(t, err)
	require.NotNil(t, session.UserID)
	require.Equal(t, userID, *session.UserID)

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
