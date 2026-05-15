package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func insertTokenTestUser(t *testing.T, ctx context.Context, tx database.QueryExecutor, pid, tid, schemaURL, userID string) {
	t.Helper()
	_, err := tx.Exec(ctx, `INSERT INTO zitadel_nextgen.projects (id) VALUES ($1)`, pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1,$2)`, pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1,$2,$3::json)`,
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	attr, err := domain.NewCreateAttribute("country", "CH", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	teamCopy := tid
	require.NoError(t, repository.NewUserRepository().Create(ctx, tx, &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		TeamID:     &teamCopy,
		Attributes: []*domain.CreateAttribute{attr},
	}))
}

func TestTokenRepository_CRUD_OIDCAccessToken(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-repo"
		tid       = "team-token-repo"
		schemaURL = "https://schemas.test/tokens/v1.json"
		userID    = "usr_token_1"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	tokenRepo := repository.NewTokenRepository(tx)
	exp := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	oidcSess := "oidc_sess_abc"
	tok := &domain.Token{
		ProjectID:     pid,
		TokenID:       "tok_opaque_1",
		UserID:        userID,
		Type:          domain.TokenTypeOIDCAccessToken,
		OIDCSessionID: &oidcSess,
		Scope:         []string{"openid", "profile"},
		ExpiresAt:     &exp,
	}
	require.NoError(t, tokenRepo.Create(ctx, tx, tok))

	got, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.NoError(t, err)
	require.Equal(t, pid, got.ProjectID)
	require.Equal(t, tok.TokenID, got.TokenID)
	require.Equal(t, userID, got.UserID)
	require.Nil(t, got.SessionID)
	require.NotNil(t, got.OIDCSessionID)
	require.Equal(t, oidcSess, *got.OIDCSessionID)
	require.Nil(t, got.SAMLSessionID)
	require.Equal(t, []string{"openid", "profile"}, got.Scope)
	require.Equal(t, domain.TokenTypeOIDCAccessToken, got.Type)
	require.NotNil(t, got.ExpiresAt)
	require.True(t, exp.Equal(*got.ExpiresAt))
	require.NotZero(t, got.CreatedAt)

	list, err := tokenRepo.List(ctx, tx, database.WithCondition(tokenRepo.ProjectIDCondition(pid)))
	require.NoError(t, err)
	require.Len(t, list, 1)

	require.NoError(t, tokenRepo.Delete(ctx, tx, tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))

	_, err = tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTokenRepository_SessionToken(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-session"
		tid       = "team-token-session"
		schemaURL = "https://schemas.test/tokens-session/v1.json"
		userID    = "usr_token_session"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	sess := "sess_internal"
	tok := &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_session",
		UserID:    userID,
		Type:      domain.TokenTypeSessionToken,
		SessionID: &sess,
		Scope:     []string{"session"},
	}
	tokenRepo := repository.NewTokenRepository(tx)
	require.NoError(t, tokenRepo.Create(ctx, tx, tok))

	got, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypeSessionToken, got.Type)
	require.NotNil(t, got.SessionID)
	require.Equal(t, sess, *got.SessionID)
	require.Nil(t, got.OIDCSessionID)
	require.Nil(t, got.SAMLSessionID)
}

func TestTokenRepository_SAMLAssertion(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-saml"
		tid       = "team-token-saml"
		schemaURL = "https://schemas.test/tokens-saml/v1.json"
		userID    = "usr_token_saml"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	samlSess := "saml_sess_1"
	tok := &domain.Token{
		ProjectID:     pid,
		TokenID:       "tok_saml",
		UserID:        userID,
		Type:          domain.TokenTypeSAMLAssertion,
		SAMLSessionID: &samlSess,
		Scope:         []string{"saml"},
	}
	tokenRepo := repository.NewTokenRepository(tx)
	require.NoError(t, tokenRepo.Create(ctx, tx, tok))

	got, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypeSAMLAssertion, got.Type)
	require.Nil(t, got.SessionID)
	require.Nil(t, got.OIDCSessionID)
	require.NotNil(t, got.SAMLSessionID)
	require.Equal(t, samlSess, *got.SAMLSessionID)
}

func TestTokenRepository_PersonalAccessToken(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-null"
		tid       = "team-token-null"
		schemaURL = "https://schemas.test/tokens-null/v1.json"
		userID    = "usr_token_null"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	tok := &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_pat_like",
		UserID:    userID,
		Type:      domain.TokenTypePersonalAccessToken,
		Scope:     nil,
		ExpiresAt: nil,
	}
	tokenRepo := repository.NewTokenRepository(tx)
	require.NoError(t, tokenRepo.Create(ctx, tx, tok))

	got, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypePersonalAccessToken, got.Type)
	require.Nil(t, got.SessionID)
	require.Nil(t, got.OIDCSessionID)
	require.Nil(t, got.SAMLSessionID)
	require.Nil(t, got.ExpiresAt)
	require.Equal(t, []string{}, got.Scope)
	require.NotZero(t, got.CreatedAt)
}

func TestTokenRepository_CreateRejectsWrongIdentifier(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-wrong-id"
		tid       = "team-token-wrong-id"
		schemaURL = "https://schemas.test/tokens-wrong/v1.json"
		userID    = "usr_token_wrong"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	sess := "sess_wrong_column"
	tokenRepo := repository.NewTokenRepository(tx)
	err := tokenRepo.Create(ctx, tx, &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_wrong",
		UserID:    userID,
		Type:      domain.TokenTypeOIDCAccessToken,
		SessionID: &sess,
		Scope:     []string{"openid"},
	})
	require.ErrorIs(t, err, domain.ErrInvalidTokenIdentifiers)
}

func TestTokenRepository_DeleteRequiresPK(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()

	repo := repository.NewTokenRepository(tx)
	err := repo.Delete(t.Context(), tx, repo.ProjectIDCondition("only-project"))
	require.ErrorIs(t, err, new(database.MissingConditionError))
}

func TestTokenRepository_CascadeUserDelete(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-cascade"
		tid       = "team-token-cascade"
		schemaURL = "https://schemas.test/tokens-cascade/v1.json"
		userID    = "usr_token_cascade"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	sess := "sess_cascade"
	tokenRepo := repository.NewTokenRepository(tx)
	require.NoError(t, tokenRepo.Create(ctx, tx, &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_cascade",
		UserID:    userID,
		Type:      domain.TokenTypeSessionToken,
		SessionID: &sess,
		Scope:     []string{"read"},
	}))

	userRepo := repository.NewUserRepository()
	require.NoError(t, userRepo.Delete(ctx, tx, userRepo.PrimaryKeyCondition(pid, userID)))

	_, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, "tok_cascade")))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTokenRepository_CreateRejectsUnspecifiedType(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	const (
		pid       = "proj-token-bad-type"
		tid       = "team-token-bad-type"
		schemaURL = "https://schemas.test/tokens-bad/v1.json"
		userID    = "usr_token_bad"
	)
	insertTokenTestUser(t, ctx, tx, pid, tid, schemaURL, userID)

	tokenRepo := repository.NewTokenRepository(tx)
	err := tokenRepo.Create(ctx, tx, &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_bad",
		UserID:    userID,
		Type:      domain.TokenTypeUnspecified,
		Scope:     []string{"read"},
	})
	require.ErrorIs(t, err, domain.ErrInvalidTokenType)
}
