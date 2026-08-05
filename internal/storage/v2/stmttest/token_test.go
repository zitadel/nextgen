//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTokenStatements_GetByID(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("returns_created_token", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-tok-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Token User")))

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
			require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
			require.NotEmpty(t, tok.TokenID)
			t.Cleanup(func() {
				_ = d.stmts.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
			})

			got, err := d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
			require.NoError(t, err)
			assert.Equal(t, projectID, got.ProjectID)
			assert.Equal(t, tok.TokenID, got.TokenID)
			assert.Equal(t, userID, got.UserID)
			assert.Equal(t, domain.TokenTypeOIDCAccessToken, got.Type)
			require.NotNil(t, got.OIDCSessionID)
			assert.Equal(t, oidcSess, *got.OIDCSessionID)
			assert.Equal(t, []string{"openid", "profile"}, got.Scope)
			require.NotNil(t, got.ExpiresAt)
			assert.True(t, exp.Equal(*got.ExpiresAt))
			assert.False(t, got.CreatedAt.IsZero())
		})

		t.Run("missing_returns_NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.GetTokenByID(t.Context(), projectID, "999999")
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}

func TestTokenStatements_List_CursorNilExpiresAt(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		userID := "usr-tok-cur-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Cursor User")))

		ids := make([]string, 0, 3)
		for range 3 {
			tok := &domain.Token{
				ProjectID: projectID,
				UserID:    userID,
				Type:      domain.TokenTypePersonalAccessToken,
				ExpiresAt: nil,
			}
			require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
			require.NotEmpty(t, tok.TokenID)
			ids = append(ids, tok.TokenID)
			tokenID := tok.TokenID
			t.Cleanup(func() {
				_ = d.stmts.DeleteTokenByID(context.Background(), projectID, tokenID)
			})
		}

		page := database.Page[domain.TokenField]{
			Limit: 1,
			OrderBy: database.OrderBy[domain.TokenField]{
				Columns: []database.Column[domain.TokenField]{
					database.Col(domain.TokenFieldExpiresAt),
					database.Col(domain.TokenFieldTokenID),
				},
				Direction: database.OrderAsc,
			},
		}
		filter := database.And(
			database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
			database.Equal(database.Col(domain.TokenFieldUserID), userID),
		)

		first, err := d.stmts.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
			Filter:     filter,
			Pagination: page,
		})
		require.NoError(t, err)
		require.Len(t, first.Items, 1)
		require.NotEmpty(t, first.NextCursor)
		assert.Contains(t, ids, first.Items[0].TokenID)

		page.Cursor = first.NextCursor
		second, err := d.stmts.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
			Filter:     filter,
			Pagination: page,
		})
		require.NoError(t, err)
		require.Len(t, second.Items, 1)
		assert.NotEqual(t, first.Items[0].TokenID, second.Items[0].TokenID)
		assert.Contains(t, ids, second.Items[0].TokenID)
	})
}

// TestTokenStatements_Revocation pins the revocation contract every dialect
// owes the token verifier (ADR 037): revoking deletes the record, so the
// verifier can no longer resolve the token and the table keeps no rows that
// grant nothing.
func TestTokenStatements_Revocation(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("revoked_record_is_gone", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-rev-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Revoke User")))

			sessionID := "sess-rev-" + uniqueSuffix(t)
			tok := &domain.Token{
				ProjectID: projectID,
				UserID:    userID,
				Type:      domain.TokenTypeSessionToken,
				SessionID: &sessionID,
				Scope:     []string{},
			}
			require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
			t.Cleanup(func() {
				_ = d.stmts.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
			})

			// A fresh record is active.
			got, err := d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
			require.NoError(t, err)
			assert.True(t, got.Active(time.Now()), "a fresh record grants its token")

			require.NoError(t, d.stmts.DeleteTokenByID(t.Context(), projectID, tok.TokenID))

			// The record is gone, so the verifier resolves nothing.
			_, err = d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			// Revoking again is a no-op rather than an error.
			require.NoError(t, d.stmts.DeleteTokenByID(t.Context(), projectID, tok.TokenID))
		})

		t.Run("revoking_a_session_deletes_the_tokens_it_issued", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-rev-sess-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Session Revoke User")))

			sessionID := "sess-multi-" + uniqueSuffix(t)
			otherSessionID := "sess-other-" + uniqueSuffix(t)
			newSessionToken := func(session string) *domain.Token {
				tok := &domain.Token{
					ProjectID: projectID,
					UserID:    userID,
					Type:      domain.TokenTypeSessionToken,
					SessionID: &session,
					Scope:     []string{},
				}
				require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
				t.Cleanup(func() {
					_ = d.stmts.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
				})
				return tok
			}
			// Two tokens on the session (a rotation would leave exactly this).
			first, second := newSessionToken(sessionID), newSessionToken(sessionID)
			untouched := newSessionToken(otherSessionID)

			require.NoError(t, d.stmts.DeleteTokensBySessionID(t.Context(), projectID, sessionID))

			for _, tok := range []*domain.Token{first, second} {
				_, err := d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
				assert.ErrorIs(t, err, new(database.NoRowFoundError))
			}

			// Another session's token is untouched.
			_, err := d.stmts.GetTokenByID(t.Context(), projectID, untouched.TokenID)
			assert.NoError(t, err)
		})

		t.Run("expired_record_is_inactive_without_revocation", func(t *testing.T) {
			projectID, schemaURL := ensureUserTestProject(t, d.stmts)
			userID := "usr-exp-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Expired User")))

			past := time.Now().Add(-time.Hour)
			sessionID := "sess-exp-" + uniqueSuffix(t)
			tok := &domain.Token{
				ProjectID: projectID,
				UserID:    userID,
				Type:      domain.TokenTypeSessionToken,
				SessionID: &sessionID,
				Scope:     []string{},
				ExpiresAt: &past,
			}
			require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
			t.Cleanup(func() {
				_ = d.stmts.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
			})

			got, err := d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
			require.NoError(t, err)
			assert.False(t, got.Active(time.Now()), "an expired record grants nothing even unrevoked")
		})

		t.Run("revoking_an_unknown_token_is_a_no_op", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			assert.NoError(t, d.stmts.DeleteTokenByID(t.Context(), projectID, "tkn-does-not-exist"))
		})

		t.Run("project_credentials_are_storable_and_revocable", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)

			for _, tokenType := range []domain.TokenType{
				domain.TokenTypeProjectToken,
				domain.TokenTypeProjectPreview,
			} {
				t.Run(tokenType.String(), func(t *testing.T) {
					// A project credential authenticates software: no user, no session.
					tok := &domain.Token{
						ProjectID: projectID,
						Type:      tokenType,
						Scope:     []string{"project.read"},
					}
					require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
					require.NotEmpty(t, tok.TokenID, "persisting mints the jti that makes the secret revocable")
					t.Cleanup(func() {
						_ = d.stmts.DeleteTokenByID(context.Background(), projectID, tok.TokenID)
					})

					got, err := d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
					require.NoError(t, err)
					assert.Equal(t, tokenType, got.Type)
					assert.Empty(t, got.UserID)
					assert.Nil(t, got.SessionID)
					assert.True(t, got.Active(time.Now()))

					require.NoError(t, d.stmts.DeleteTokenByID(t.Context(), projectID, tok.TokenID))
					_, err = d.stmts.GetTokenByID(t.Context(), projectID, tok.TokenID)
					assert.ErrorIs(t, err, new(database.NoRowFoundError))
				})
			}
		})
	})
}
