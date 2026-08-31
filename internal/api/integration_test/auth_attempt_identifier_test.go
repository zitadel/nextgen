//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestAuthAttempt_CrossSchemaIdentifierResolution exercises the direct-API
// identifier proof (no attribute name) end to end per ADR 058 §5: the bare
// value resolves against the designated identifier of every user schema in
// the project, scoped to each schema's own users, and must match exactly one
// user across the set.
func TestAuthAttempt_CrossSchemaIdentifierResolution(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	// A second schema alongside the seeded default (which designates email):
	// the ADR's admin pattern — sign-in by username, email kept non-unique as
	// a notification address.
	const adminSchema = `{
		"title": "AdminUserSchema",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://admin.example.com/schemas/admin-user.json",
		"kind": "user-schema",
		"type": "object",
		"x-identifier": "username",
		"x-auth-methods": {"password": {"enabled": true}},
		"required": ["username"],
		"properties": {
			"username": {"type": "string", "x-unique": "project"},
			"email": {"type": "string", "format": "email"}
		}
	}`
	adminSchemaURL := harness.CreateUserSchema(t, project, adminSchema)

	users := harness.EnsureUserService(t)
	humanSchemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	human, err := users.CreateUser(t.Context(), service.CreateUserInput{
		ProjectID: project.ID,
		SchemaURL: humanSchemaURL,
		Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t,
			"cross-schema.human@example.com"),
	})
	require.NoError(t, err)

	// The admin shares the human's email address — non-unique on the admin
	// schema, so it must never interfere with the human's resolution.
	admin, err := users.CreateUser(t.Context(), service.CreateUserInput{
		ProjectID: project.ID,
		SchemaURL: adminSchemaURL,
		Attributes: map[string]any{
			"username": "cross-schema-admin",
			"email":    "cross-schema.human@example.com",
		},
	})
	require.NoError(t, err)

	resolve := func(t *testing.T, loginName string) (*domain.AuthAttempt, error) {
		t.Helper()
		attempts := harness.EnsureAuthAttemptService(t)
		attempt, err := attempts.Create(t.Context(), service.CreateAuthAttemptInput{
			ProjectID:      project.ID,
			RequiredChecks: []domain.AuthCheckType{domain.AuthCheckTypeUser},
		})
		require.NoError(t, err)
		attempt, err = attempts.IssueChallenge(t.Context(), service.IssueChallengeInput{
			ProjectID: project.ID,
			AttemptID: attempt.ID,
			Challenge: service.UserChallenge{},
		})
		require.NoError(t, err)
		challenge, ok := attempt.ChallengeByType(domain.AuthCheckTypeUser)
		require.True(t, ok)
		return attempts.VerifyProof(t.Context(), service.VerifyProofInput{
			ProjectID:   project.ID,
			AttemptID:   attempt.ID,
			ChallengeID: challenge.GetID(),
			// No AttributeName: the direct-API cross-schema path.
			Proof: service.UserProof{LoginName: loginName},
		})
	}

	requireResolvedUser := func(t *testing.T, attempt *domain.AuthAttempt, userID string) {
		t.Helper()
		factor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
		require.True(t, ok)
		assert.Equal(t, userID, factor.UserID)
	}

	t.Run("resolves the human by designated email despite the admin's equal notification address", func(t *testing.T) {
		attempt, err := resolve(t, "cross-schema.human@example.com")
		require.NoError(t, err)
		requireResolvedUser(t, attempt, human.ID)
	})

	t.Run("resolves the admin by designated username", func(t *testing.T) {
		attempt, err := resolve(t, "cross-schema-admin")
		require.NoError(t, err)
		requireResolvedUser(t, attempt, admin.ID)
	})

	t.Run("rejects an unknown identifier", func(t *testing.T) {
		_, err := resolve(t, "nobody@example.com")
		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
	})

	t.Run("rejects a value held by two designated identifier properties", func(t *testing.T) {
		// A second human whose designated email equals a second admin's
		// designated username: cross-schema resolution must reject the
		// ambiguity rather than pick a schema (zitadel/zitadel#10782).
		const collidingValue = "cross-schema.collision@example.com"
		_, err := users.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  humanSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, collidingValue),
		})
		require.NoError(t, err)
		_, err = users.CreateUser(t.Context(), service.CreateUserInput{
			ProjectID: project.ID,
			SchemaURL: adminSchemaURL,
			Attributes: map[string]any{
				"username": collidingValue,
			},
		})
		require.NoError(t, err)

		_, err = resolve(t, collidingValue)
		assert.ErrorIs(t, err, domain.ErrAuthAttemptProofRejected(nil))
	})
}
