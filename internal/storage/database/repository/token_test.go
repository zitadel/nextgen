package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/repository"
)

func TestTokenRepository_CRUD(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	userRepo := repository.NewUserRepository()
	tokenRepo := repository.NewTokenRepository(tx)

	const (
		pid       = "proj-token-repo"
		tid       = "team-token-repo"
		schemaURL = "https://schemas.test/tokens/v1.json"
		userID    = "usr_token_1"
	)

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
	require.NoError(t, userRepo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		TeamID:     &teamCopy,
		Attributes: []*domain.CreateAttribute{attr},
	}))

	exp := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	sess := "sess_abc"
	tok := &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_opaque_1",
		UserID:    userID,
		Type:      domain.TokenTypeOIDCAccessToken,
		SessionID: &sess,
		Scope:     []string{"openid", "profile"},
		ExpiresAt: &exp,
	}
	require.NoError(t, tokenRepo.Create(ctx, tx, tok))

	got, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.NoError(t, err)
	require.Equal(t, pid, got.ProjectID)
	require.Equal(t, tok.TokenID, got.TokenID)
	require.Equal(t, userID, got.UserID)
	require.NotNil(t, got.SessionID)
	require.Equal(t, sess, *got.SessionID)
	require.Equal(t, []string{"openid", "profile"}, got.Scope)
	require.Equal(t, domain.TokenTypeOIDCAccessToken, got.Type)
	require.NotNil(t, got.ExpiresAt)
	require.True(t, exp.Equal(*got.ExpiresAt))
	require.NotZero(t, got.CreatedAt)

	list, err := tokenRepo.List(ctx, tx, database.WithCondition(tokenRepo.ProjectIDCondition(pid)))
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, tok.TokenID, list[0].TokenID)

	byUser, err := tokenRepo.List(ctx, tx, database.WithCondition(
		database.And(tokenRepo.ProjectIDCondition(pid), tokenRepo.UserIDCondition(userID)),
	))
	require.NoError(t, err)
	require.Len(t, byUser, 1)

	require.NoError(t, tokenRepo.Delete(ctx, tx, tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))

	_, err = tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTokenRepository_NullSessionAndExpiry(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	userRepo := repository.NewUserRepository()
	tokenRepo := repository.NewTokenRepository(tx)

	const (
		pid       = "proj-token-null"
		tid       = "team-token-null"
		schemaURL = "https://schemas.test/tokens-null/v1.json"
		userID    = "usr_token_null"
	)

	_, err := tx.Exec(ctx, `INSERT INTO zitadel_nextgen.projects (id) VALUES ($1)`, pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1,$2)`, pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1,$2,$3::json)`,
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	attr, err := domain.NewCreateAttribute("country", "DE", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	teamCopy := tid
	require.NoError(t, userRepo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		TeamID:     &teamCopy,
		Attributes: []*domain.CreateAttribute{attr},
	}))

	tok := &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_pat_like",
		UserID:    userID,
		Type:      domain.TokenTypePersonalAccessToken,
		SessionID: nil,
		Scope:     nil,
		ExpiresAt: nil,
	}
	require.NoError(t, tokenRepo.Create(ctx, tx, tok))

	got, err := tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, tok.TokenID)))
	require.NoError(t, err)
	require.Equal(t, domain.TokenTypePersonalAccessToken, got.Type)
	require.Nil(t, got.SessionID)
	require.Nil(t, got.ExpiresAt)
	require.Equal(t, []string{}, got.Scope)
	require.NotZero(t, got.CreatedAt)
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

	userRepo := repository.NewUserRepository()
	tokenRepo := repository.NewTokenRepository(tx)

	const (
		pid       = "proj-token-cascade"
		tid       = "team-token-cascade"
		schemaURL = "https://schemas.test/tokens-cascade/v1.json"
		userID    = "usr_token_cascade"
	)

	_, err := tx.Exec(ctx, `INSERT INTO zitadel_nextgen.projects (id) VALUES ($1)`, pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1,$2)`, pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1,$2,$3::json)`,
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	attr, err := domain.NewCreateAttribute("country", "FR", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	teamCopy := tid
	require.NoError(t, userRepo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		TeamID:     &teamCopy,
		Attributes: []*domain.CreateAttribute{attr},
	}))

	require.NoError(t, tokenRepo.Create(ctx, tx, &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_cascade",
		UserID:    userID,
		Type:      domain.TokenTypeSessionToken,
		Scope:     []string{"read"},
	}))

	require.NoError(t, userRepo.Delete(ctx, tx, userRepo.PrimaryKeyCondition(pid, userID)))

	_, err = tokenRepo.Get(ctx, tx, database.WithCondition(tokenRepo.PrimaryKeyCondition(pid, "tok_cascade")))
	require.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTokenRepository_CreateRejectsUnspecifiedType(t *testing.T) {
	tx, rollback := transactionForRollback(t)
	defer rollback()
	ctx := t.Context()

	userRepo := repository.NewUserRepository()
	tokenRepo := repository.NewTokenRepository(tx)

	const (
		pid       = "proj-token-bad-type"
		tid       = "team-token-bad-type"
		schemaURL = "https://schemas.test/tokens-bad/v1.json"
		userID    = "usr_token_bad"
	)

	_, err := tx.Exec(ctx, `INSERT INTO zitadel_nextgen.projects (id) VALUES ($1)`, pid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO zitadel_nextgen.teams (project_id, id) VALUES ($1,$2)`, pid, tid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1,$2,$3::json)`,
		pid, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	attr, err := domain.NewCreateAttribute("country", "IT", domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	teamCopy := tid
	require.NoError(t, userRepo.Create(ctx, tx, &domain.CreateUser{
		ProjectID:  pid,
		SchemaURL:  schemaURL,
		ID:         userID,
		TeamID:     &teamCopy,
		Attributes: []*domain.CreateAttribute{attr},
	}))

	err = tokenRepo.Create(ctx, tx, &domain.Token{
		ProjectID: pid,
		TokenID:   "tok_bad",
		UserID:    userID,
		Type:      domain.TokenTypeUnspecified,
		Scope:     []string{"read"},
	})
	require.ErrorIs(t, err, domain.ErrInvalidTokenType)
}
