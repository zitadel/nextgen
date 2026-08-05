//go:build postgres_integration

package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func uniqueTokenFixtureIDs(t *testing.T) (projectID, schemaURL, userID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-token-" + suffix, "https://schemas.test/tokens/" + suffix + ".json", "usr-token-" + suffix
}

// ensureTokenTestUser creates project + schema + user rows tokens FK requires.
// User statements are not on this branch yet, so the user row is inserted via SQL.
func ensureTokenTestUser(t *testing.T, projectID, schemaURL, userID string) {
	t.Helper()
	require.NoError(t, testPool.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	require.NoError(t, testPool.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: projectID,
		URL:       schemaURL,
		Schema:    []byte(`{}`),
	}))
	t.Cleanup(func() {
		_ = testPool.DeleteJSONSchemaByID(context.Background(), projectID, schemaURL)
	})

	_, err := testPool.pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.users (project_id, id, schema_url, lifecycle_owner_team_id, status)
		 VALUES ($1, $2, $3, NULL, $4)`,
		projectID, userID, schemaURL, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = testPool.pool.Exec(context.Background(),
			`DELETE FROM zitadel_nextgen.users WHERE project_id = $1 AND id = $2`,
			projectID, userID)
	})
}

func requireGeneratedTokenID(t *testing.T, tokenID string) {
	t.Helper()
	require.NotEmpty(t, tokenID)
	require.True(t, strings.HasPrefix(tokenID, string(domain.TokenPrefix)+"_"))
}

func TestTokenStatements_CRUD_OIDCAccessToken(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	exp := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	oidcSess := "2001"
	tok := &domain.Token{
		ProjectID:     projectID,
		UserID:        userID,
		Type:          domain.TokenTypeOIDCAccessToken,
		OIDCSessionID: &oidcSess,
		Scope:         []string{"openid", "profile"},
		ExpiresAt:     &exp,
	}
	require.NoError(t, testPool.CreateToken(t.Context(), tok))
	requireGeneratedTokenID(t, tok.TokenID)
	t.Cleanup(func() {
		_ = testPool.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
	})

	got, err := testPool.GetTokenByID(t.Context(), projectID, tok.TokenID)
	require.NoError(t, err)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, tok.TokenID, got.TokenID)
	assert.Equal(t, userID, got.UserID)
	assert.Nil(t, got.SessionID)
	require.NotNil(t, got.OIDCSessionID)
	assert.Equal(t, oidcSess, *got.OIDCSessionID)
	assert.Nil(t, got.SAMLSessionID)
	assert.Equal(t, []string{"openid", "profile"}, got.Scope)
	assert.Equal(t, domain.TokenTypeOIDCAccessToken, got.Type)
	require.NotNil(t, got.ExpiresAt)
	assert.True(t, exp.Equal(*got.ExpiresAt))
	assert.False(t, got.CreatedAt.IsZero())

	listed, err := testPool.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
		Filter: database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
	})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)

	require.NoError(t, testPool.DeleteTokenByID(t.Context(), projectID, tok.TokenID))

	_, err = testPool.GetTokenByID(t.Context(), projectID, tok.TokenID)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTokenStatements_SessionToken(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	sess := "1001"
	tok := &domain.Token{
		ProjectID: projectID,
		UserID:    userID,
		Type:      domain.TokenTypeSessionToken,
		SessionID: &sess,
		Scope:     []string{"session"},
	}
	require.NoError(t, testPool.CreateToken(t.Context(), tok))
	requireGeneratedTokenID(t, tok.TokenID)
	t.Cleanup(func() {
		_ = testPool.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
	})

	got, err := testPool.GetTokenByID(t.Context(), projectID, tok.TokenID)
	require.NoError(t, err)
	assert.Equal(t, domain.TokenTypeSessionToken, got.Type)
	require.NotNil(t, got.SessionID)
	assert.Equal(t, sess, *got.SessionID)
	assert.Nil(t, got.OIDCSessionID)
	assert.Nil(t, got.SAMLSessionID)
}

func TestTokenStatements_SAMLAssertion(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	samlSess := "3001"
	tok := &domain.Token{
		ProjectID:     projectID,
		UserID:        userID,
		Type:          domain.TokenTypeSAMLAssertion,
		SAMLSessionID: &samlSess,
		Scope:         []string{"saml"},
	}
	require.NoError(t, testPool.CreateToken(t.Context(), tok))
	requireGeneratedTokenID(t, tok.TokenID)
	t.Cleanup(func() {
		_ = testPool.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
	})

	got, err := testPool.GetTokenByID(t.Context(), projectID, tok.TokenID)
	require.NoError(t, err)
	assert.Equal(t, domain.TokenTypeSAMLAssertion, got.Type)
	assert.Nil(t, got.SessionID)
	assert.Nil(t, got.OIDCSessionID)
	require.NotNil(t, got.SAMLSessionID)
	assert.Equal(t, samlSess, *got.SAMLSessionID)
}

func TestTokenStatements_PersonalAccessToken(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	tok := &domain.Token{
		ProjectID: projectID,
		UserID:    userID,
		Type:      domain.TokenTypePersonalAccessToken,
		Scope:     nil,
		ExpiresAt: nil,
	}
	require.NoError(t, testPool.CreateToken(t.Context(), tok))
	requireGeneratedTokenID(t, tok.TokenID)
	t.Cleanup(func() {
		_ = testPool.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
	})

	got, err := testPool.GetTokenByID(t.Context(), projectID, tok.TokenID)
	require.NoError(t, err)
	assert.Equal(t, domain.TokenTypePersonalAccessToken, got.Type)
	assert.Nil(t, got.SessionID)
	assert.Nil(t, got.OIDCSessionID)
	assert.Nil(t, got.SAMLSessionID)
	assert.Nil(t, got.ExpiresAt)
	assert.Equal(t, []string{}, got.Scope)
	assert.False(t, got.CreatedAt.IsZero())
}

func TestTokenStatements_CreateRejectsWrongIdentifier(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	sess := "1002"
	err := testPool.CreateToken(t.Context(), &domain.Token{
		ProjectID: projectID,
		UserID:    userID,
		Type:      domain.TokenTypeOIDCAccessToken,
		SessionID: &sess,
		Scope:     []string{"openid"},
	})
	assert.ErrorIs(t, err, domain.ErrInvalidTokenIdentifiers())
}

func TestTokenStatements_CreateRejectsClientTokenID(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	oidcSess := "2002"
	err := testPool.CreateToken(t.Context(), &domain.Token{
		ProjectID:     projectID,
		TokenID:       "42",
		UserID:        userID,
		Type:          domain.TokenTypeOIDCAccessToken,
		OIDCSessionID: &oidcSess,
		Scope:         []string{"openid"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "token_id must not be set on create")
}

func TestTokenStatements_CreateRejectsUnspecifiedType(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	err := testPool.CreateToken(t.Context(), &domain.Token{
		ProjectID: projectID,
		UserID:    userID,
		Type:      domain.TokenTypeUnspecified,
		Scope:     []string{"read"},
	})
	assert.ErrorIs(t, err, domain.ErrInvalidTokenType)
}

func TestTokenStatements_Get_NotFound(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	_, err := testPool.GetTokenByID(t.Context(), projectID, "999999")
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTokenStatements_List_NextCursorRequiresOrderBy(t *testing.T) {
	projectID, schemaURL, userID := uniqueTokenFixtureIDs(t)
	ensureTokenTestUser(t, projectID, schemaURL, userID)

	for _, sess := range []string{"2101", "2102"} {
		sess := sess
		tok := &domain.Token{
			ProjectID:     projectID,
			UserID:        userID,
			Type:          domain.TokenTypeOIDCAccessToken,
			OIDCSessionID: &sess,
			Scope:         []string{"openid"},
		}
		require.NoError(t, testPool.CreateToken(t.Context(), tok))
		requireGeneratedTokenID(t, tok.TokenID)
		t.Cleanup(func() {
			_ = testPool.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
		})
	}

	noOrder, err := testPool.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
		Filter: database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
		Pagination: database.Page[domain.TokenField]{
			Limit: 1,
		},
	})
	require.NoError(t, err)
	require.Len(t, noOrder.Items, 1)
	assert.Nil(t, noOrder.NextCursor)

	withOrder, err := testPool.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
		Filter: database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
		Pagination: database.Page[domain.TokenField]{
			Limit: 1,
			OrderBy: database.OrderBy[domain.TokenField]{
				Columns:   []database.Column[domain.TokenField]{database.Col(domain.TokenFieldTokenID)},
				Direction: database.OrderAsc,
			},
		},
	})
	require.NoError(t, err)
	require.Len(t, withOrder.Items, 1)
	assert.NotEmpty(t, withOrder.NextCursor)
}
